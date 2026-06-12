import { type PointerEvent, type ReactNode, type WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  type DiscoveryCandidate,
  type StoredC4004Device,
  type StoredC4004DevicePatch,
  discoverC4004Entities,
  fetchC4004Devices,
  updateC4004Device,
} from "./api";

type Page = "management" | "deployment" | "config" | "detail";
type ScanState = "idle" | "scanning" | "done" | "error";
type ConfigStepId = "bind" | "basic" | "feature" | "range" | "tags" | "complete";
type DetailConfigView = "none" | "range" | "tags" | "params" | "mcu";

type ManagedDevice = StoredC4004Device;

type TrackingZoneShape = "rect" | "circle";
type TrackingZoneField = "xMin" | "xMax" | "yMin" | "yMax" | "centerX" | "centerY" | "radius";
type TagType = "none" | "boundary" | "approach" | "state" | "noise";
type TagRangeShape = "circle" | "rect";
type TagRegionField = "name" | "tagType" | "rangeShape" | "index" | "ioIndex" | "xSizeCm" | "ySizeCm";
type TrackingZone = {
  id: number;
  name: string;
  occupied: boolean;
  shape: TrackingZoneShape;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  centerX: number;
  centerY: number;
  radius: number;
};
type TagRegion = {
  id: number;
  name: string;
  tagType: TagType;
  rangeShape: TagRangeShape;
  index: number;
  ioIndex: number;
  xSizeCm: number;
  ySizeCm: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};
type McuBinding = {
  zoneId: number;
  mcuIo: number | null;
  tagRegionId: number | null;
};

type RangeField = "xMin" | "xMax" | "yMin" | "yMax";
type RangeMode = "rect" | "learned" | "custom";
type RangeSketchPoint = { x: number; y: number };
type DeploymentPoint = { x: number; y: number };
type DeploymentWall = { id: number; start: DeploymentPoint; end: DeploymentPoint };
type DeploymentPlacement = {
  deviceId: string;
  x: number;
  y: number;
  rotationDeg: number;
  fovDeg: number;
  rangeM: number;
};
type DeploymentPanDrag = {
  startClient: DeploymentPoint;
  baseOffset: DeploymentPoint;
  viewBox: { width: number; height: number };
};

const rangePreviewWidth = 1000;
const rangePreviewHeight = 900;
const rangePreviewPadding = { top: 34, right: 34, bottom: 64, left: 66 };
const rangePreviewXMinM = -5;
const rangePreviewXMaxM = 5;
const rangePreviewYMinM = 0;
const rangePreviewYMaxM = 9;
const rangePreviewGridM = 1;
const rangePreviewViewBoxWidth = rangePreviewWidth + rangePreviewPadding.left + rangePreviewPadding.right;
const rangePreviewViewBoxHeight = rangePreviewHeight + rangePreviewPadding.top + rangePreviewPadding.bottom;
const rangeSketchMinDistanceM = 0.04;
const rangeConfigFields: Array<{ field: RangeField; label: string }> = [
  { field: "xMin", label: "X Min(cm)" },
  { field: "xMax", label: "X Max(cm)" },
  { field: "yMin", label: "Y Min(cm)" },
  { field: "yMax", label: "Y Max(cm)" },
];
const learnedRangePoints: RangeSketchPoint[] = [
  { x: -2.2, y: 0.8 },
  { x: 2.1, y: 1 },
  { x: 2.4, y: 6.7 },
  { x: -1.9, y: 6.9 },
];
const tagNameOptions = Array.from({ length: 8 }, (_, index) => `标签${index + 1}`);
const tagTypeOptions: Array<{ value: TagType; label: string }> = [
  { value: "none", label: "无" },
  { value: "boundary", label: "边界" },
  { value: "approach", label: "靠近远离类" },
  { value: "state", label: "状态类" },
  { value: "noise", label: "噪点类" },
];
const tagRangeShapeOptions: Array<{ value: TagRangeShape; label: string }> = [
  { value: "circle", label: "圆" },
  { value: "rect", label: "矩形" },
];
const tagIndexMin = 2;
const tagIndexMax = 6;

const statusText: Record<ScanState, string> = {
  idle: "待扫描",
  scanning: "扫描中",
  done: "已完成",
  error: "扫描失败",
};

const configSteps: Array<{ id: ConfigStepId; title: string; subtitle: string }> = [
  { id: "bind", title: "绑定设备", subtitle: "确认设备 / 建立绑定" },
  { id: "basic", title: "基础信息配置", subtitle: "安装模式 / 高度 / 角度" },
  { id: "feature", title: "功能使能配置", subtitle: "人数统计 / 轨迹 LED / 运动 LED" },
  { id: "range", title: "探测范围配置", subtitle: "坐标轴 / 四方范围 / 轨迹学习" },
  { id: "tags", title: "标签配置", subtitle: "GPIO / 区域标签 / 多区域绑定" },
  { id: "complete", title: "配置完成", subtitle: "跳转到设备详情显示界面" },
];

const trackingCanvasWidth = 1000;
const trackingCanvasHeight = 800;
const trackingCanvasPadding = 36;
const trackingXMinMm = -5000;
const trackingXMaxMm = 5000;
const trackingYMinMm = 0;
const trackingYMaxMm = 8000;
const trackingGridMm = 1000;
const trackingXRangeMm = trackingXMaxMm - trackingXMinMm;
const trackingYRangeMm = trackingYMaxMm - trackingYMinMm;
const deploymentWorld = {
  xMin: -10000,
  xMax: 10000,
  yMin: -7000,
  yMax: 9000,
};
const deploymentGridMm = 1000;
const deploymentSnapMm = 250;
const deploymentWorldWidth = deploymentWorld.xMax - deploymentWorld.xMin;
const deploymentWorldHeight = deploymentWorld.yMax - deploymentWorld.yMin;
const deploymentWorldCenter = {
  x: (deploymentWorld.xMin + deploymentWorld.xMax) / 2,
  y: (deploymentWorld.yMin + deploymentWorld.yMax) / 2,
};

const toTrackingCanvasX = (value: number) => ((value - trackingXMinMm) / trackingXRangeMm) * trackingCanvasWidth;
const toTrackingCanvasY = (value: number) => ((trackingYMaxMm - value) / trackingYRangeMm) * trackingCanvasHeight;
const toTrackingCanvasCoord = (point: { x: number; y: number }) => ({
  x: toTrackingCanvasX(point.x),
  y: toTrackingCanvasY(point.y),
});

const clampRangePreviewValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toRangePreviewX = (value: number) =>
  ((value - rangePreviewXMinM) / (rangePreviewXMaxM - rangePreviewXMinM)) * rangePreviewWidth;
const toRangePreviewY = (value: number) =>
  rangePreviewHeight - ((value - rangePreviewYMinM) / (rangePreviewYMaxM - rangePreviewYMinM)) * rangePreviewHeight;
const toRangePreviewPoint = (point: { x: number; y: number }) => ({
  x: toRangePreviewX(point.x),
  y: toRangePreviewY(point.y),
});
const formatRangeSketchPoints = (points: Array<{ x: number; y: number }>) =>
  points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
const roundRangeSketchValue = (value: number) => Math.round(value * 100) / 100;
const clampDeploymentZoom = (value: number) => Math.min(5, Math.max(0.1, value));
const snapDeploymentPoint = (point: DeploymentPoint): DeploymentPoint => ({
  x: Math.round(point.x / deploymentSnapMm) * deploymentSnapMm,
  y: Math.round(point.y / deploymentSnapMm) * deploymentSnapMm,
});
const formatDeploymentMeters = (valueMm: number) => `${(valueMm / 1000).toFixed(1)}m`;
const getDeploymentSvgPoint = (
  event: { clientX: number; clientY: number },
  svgEl: SVGSVGElement | null,
): DeploymentPoint | null => {
  if (!svgEl) {
    return null;
  }
  const point = svgEl.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svgEl.getScreenCTM();
  if (!matrix) {
    return null;
  }
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
};

const initialTrackingZones: TrackingZone[] = [
  {
    id: 1,
    name: "Zone 1",
    occupied: true,
    shape: "rect",
    xMin: -4700,
    xMax: -2500,
    yMin: 5200,
    yMax: 7600,
    centerX: -3600,
    centerY: 6400,
    radius: 900,
  },
  {
    id: 2,
    name: "Zone 2",
    occupied: false,
    shape: "circle",
    xMin: -1900,
    xMax: 300,
    yMin: 5000,
    yMax: 7200,
    centerX: -800,
    centerY: 6100,
    radius: 1050,
  },
  {
    id: 3,
    name: "Zone 3",
    occupied: true,
    shape: "rect",
    xMin: 2000,
    xMax: 4550,
    yMin: 4800,
    yMax: 7200,
    centerX: 3275,
    centerY: 6000,
    radius: 1000,
  },
  {
    id: 4,
    name: "Zone 4",
    occupied: false,
    shape: "circle",
    xMin: -4300,
    xMax: -2100,
    yMin: 1300,
    yMax: 3500,
    centerX: -3200,
    centerY: 2400,
    radius: 1100,
  },
  {
    id: 5,
    name: "Zone 5",
    occupied: false,
    shape: "rect",
    xMin: -950,
    xMax: 1450,
    yMin: 700,
    yMax: 2850,
    centerX: 250,
    centerY: 1775,
    radius: 900,
  },
  {
    id: 6,
    name: "Zone 6",
    occupied: true,
    shape: "circle",
    xMin: 2250,
    xMax: 4550,
    yMin: 1400,
    yMax: 3700,
    centerX: 3400,
    centerY: 2550,
    radius: 1150,
  },
];

const initialTagRegions: TagRegion[] = [
  {
    id: 1,
    name: "标签1",
    tagType: "none",
    rangeShape: "circle",
    index: 2,
    ioIndex: 2,
    xSizeCm: 80,
    ySizeCm: 0,
    xMin: -1.6,
    xMax: 0,
    yMin: 1.0,
    yMax: 2.6,
  },
  {
    id: 2,
    name: "标签2",
    tagType: "boundary",
    rangeShape: "rect",
    index: 3,
    ioIndex: 3,
    xSizeCm: 160,
    ySizeCm: 220,
    xMin: 0.2,
    xMax: 1.8,
    yMin: 1.2,
    yMax: 3.4,
  },
];
const initialMcuBindings: McuBinding[] = Array.from({ length: 6 }, (_, index) => ({
  zoneId: index + 1,
  mcuIo: null,
  tagRegionId: null,
}));

const trackingTargets = [
  { index: 1, id: "T01", active: true, kinesia: 68, feature: "Human", x: 1.42, y: 2.18 },
  { index: 2, id: "T02", active: true, kinesia: 12, feature: "Human", x: -0.74, y: 1.35 },
  { index: 3, id: "T03", active: true, kinesia: 84, feature: "Human", x: 2.36, y: 4.64 },
  { index: 4, id: "T04", active: true, kinesia: 25, feature: "Presence", x: -1.18, y: 6.72 },
  { index: 5, id: null, active: false, kinesia: null, feature: null, x: null, y: null },
  { index: 6, id: null, active: false, kinesia: null, feature: null, x: null, y: null },
  { index: 7, id: null, active: false, kinesia: null, feature: null, x: null, y: null },
  { index: 8, id: null, active: false, kinesia: null, feature: null, x: null, y: null },
];

const trajectoryPointsMeters = [
  { x: -1.95, y: 1.2 },
  { x: -1.38, y: 1.8 },
  { x: -0.82, y: 2.5 },
  { x: -0.18, y: 3.2 },
  { x: 0.72, y: 4.0 },
  { x: 1.62, y: 4.8 },
  { x: 2.36, y: 5.6 },
];

const copyInitialTrackingZones = () => initialTrackingZones.map((zone) => ({ ...zone }));
const copyInitialTagRegions = () => initialTagRegions.map((region) => ({ ...region }));

const clampTagSizeCm = (value: number) => Math.min(1000, Math.max(1, value));
const clampTagIndex = (value: number) => Math.min(tagIndexMax, Math.max(tagIndexMin, Math.round(value)));

const syncTagRegionGeometry = (region: TagRegion): TagRegion => {
  const centerX = (region.xMin + region.xMax) / 2;
  const centerY = (region.yMin + region.yMax) / 2;

  if (region.rangeShape === "circle") {
    const radiusM = clampTagSizeCm(region.xSizeCm) / 100;
    return {
      ...region,
      xSizeCm: clampTagSizeCm(region.xSizeCm),
      xMin: centerX - radiusM,
      xMax: centerX + radiusM,
      yMin: centerY - radiusM,
      yMax: centerY + radiusM,
    };
  }

  const halfWidthM = clampTagSizeCm(region.xSizeCm) / 200;
  const halfHeightM = clampTagSizeCm(region.ySizeCm) / 200;
  return {
    ...region,
    xSizeCm: clampTagSizeCm(region.xSizeCm),
    ySizeCm: clampTagSizeCm(region.ySizeCm),
    xMin: centerX - halfWidthM,
    xMax: centerX + halfWidthM,
    yMin: centerY - halfHeightM,
    yMax: centerY + halfHeightM,
  };
};

const clampTrackingField = (field: TrackingZoneField, value: number) => {
  if (field === "radius") {
    return Math.min(5000, Math.max(100, value));
  }

  const min = field.toLowerCase().includes("x") ? trackingXMinMm : trackingYMinMm;
  const max = field.toLowerCase().includes("x") ? trackingXMaxMm : trackingYMaxMm;
  return Math.min(max, Math.max(min, value));
};

const toMetersValue = (value: number) => Number((value / 1000).toFixed(2));

const toDevice = (candidate: DiscoveryCandidate, index: number): ManagedDevice => {
  const displayPrefix = candidate.prefix || "auto";

  return {
    id: candidate.deviceId ?? `${displayPrefix}-${index}`,
    haDeviceId: candidate.deviceId,
    name: candidate.deviceName ?? `C4004 设备 ${index + 1}`,
    model: candidate.deviceModel ?? "DFRobot C4004",
    manufacturer: candidate.manufacturer,
    firmwareVersion: candidate.firmwareVersion,
    prefix: displayPrefix,
    status: candidate.status ?? "offline",
    signal: Math.min(98, 64 + candidate.score * 4),
    entityCount: candidate.entities.length,
    macAddress: candidate.macAddress ?? "未获取",
    bound: false,
    initialized: false,
    lastSeen: "刚刚",
    entities: candidate.entities,
    discoveredAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
};

function App() {
  const [page, setPage] = useState<Page>("management");
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [devices, setDevices] = useState<ManagedDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<ConfigStepId>("bind");
  const [detailConfigView, setDetailConfigView] = useState<DetailConfigView>("none");
  const [mountMode, setMountMode] = useState("侧装");
  const [mountHeightCm, setMountHeightCm] = useState("180");
  const [mountAngleDeg, setMountAngleDeg] = useState("0");
  const [presenceEnabled, setPresenceEnabled] = useState(true);
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [realTimePeopleTime, setRealTimePeopleTime] = useState("3");
  const [trackMeters, setTrackMeters] = useState("0.35");
  const [trackExistsTime, setTrackExistsTime] = useState("8");
  const [unmannedTime, setUnmannedTime] = useState("30");
  const [checkToActiveFrames, setCheckToActiveFrames] = useState("3");
  const [trackLedEnabled, setTrackLedEnabled] = useState(true);
  const [motionLedEnabled, setMotionLedEnabled] = useState(true);
  const [trackLearningEnabled, setTrackLearningEnabled] = useState(false);
  const [learnedRangeModeEnabled, setLearnedRangeModeEnabled] = useState(true);
  const [customRangeModeEnabled, setCustomRangeModeEnabled] = useState(false);
  const [rangeMode, setRangeMode] = useState<RangeMode>("rect");
  const [customRangePoints, setCustomRangePoints] = useState<RangeSketchPoint[]>([]);
  const [customRangePreviewPoint, setCustomRangePreviewPoint] = useState<RangeSketchPoint | null>(null);
  const [customRangeConfirmed, setCustomRangeConfirmed] = useState(false);
  const rangeChartRef = useRef<SVGSVGElement | null>(null);
  const trackingChartRef = useRef<SVGSVGElement | null>(null);
  const deploymentCanvasRef = useRef<SVGSVGElement | null>(null);
  const [rangeConfig, setRangeConfig] = useState({ xMin: -200, xMax: 200, yMin: 0, yMax: 700 });
  const [trackingZones, setTrackingZones] = useState<TrackingZone[]>(copyInitialTrackingZones);
  const [tagRegions, setTagRegions] = useState<TagRegion[]>(copyInitialTagRegions);
  const [mcuBindings, setMcuBindings] = useState<McuBinding[]>(initialMcuBindings);
  const [selectedTagRegionId, setSelectedTagRegionId] = useState<number | null>(initialTagRegions[0]?.id ?? null);
  const [deploymentZoom, setDeploymentZoom] = useState(1);
  const [deploymentPanOffset, setDeploymentPanOffset] = useState<DeploymentPoint>(deploymentWorldCenter);
  const [deploymentPanDrag, setDeploymentPanDrag] = useState<DeploymentPanDrag | null>(null);
  const [deploymentWalls, setDeploymentWalls] = useState<DeploymentWall[]>([]);
  const [isDrawingDeploymentWall, setIsDrawingDeploymentWall] = useState(false);
  const [deploymentWallStart, setDeploymentWallStart] = useState<DeploymentPoint | null>(null);
  const [deploymentWallPreview, setDeploymentWallPreview] = useState<DeploymentPoint | null>(null);
  const [deploymentPlacements, setDeploymentPlacements] = useState<Record<string, DeploymentPlacement>>({});
  const [selectedDeploymentDeviceId, setSelectedDeploymentDeviceId] = useState<string | null>(null);
  const [draggingDeploymentDeviceId, setDraggingDeploymentDeviceId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );
  const boundDevices = useMemo(() => devices.filter((device) => device.bound), [devices]);
  const selectedTagRegion = useMemo(
    () => tagRegions.find((region) => region.id === selectedTagRegionId) ?? tagRegions[0] ?? null,
    [selectedTagRegionId, tagRegions],
  );
  const stateTagRegions = useMemo(
    () => tagRegions.filter((region) => region.tagType === "state"),
    [tagRegions],
  );
  const deploymentViewBox = useMemo(() => {
    const width = deploymentWorldWidth / deploymentZoom;
    const height = deploymentWorldHeight / deploymentZoom;
    return {
      x: deploymentPanOffset.x - width / 2,
      y: deploymentPanOffset.y - height / 2,
      width,
      height,
    };
  }, [deploymentPanOffset, deploymentZoom]);
  const deploymentGridLines = useMemo(() => {
    const vertical: number[] = [];
    const horizontal: number[] = [];
    const padding = deploymentGridMm * 2;
    const xMin = Math.floor(deploymentViewBox.x / deploymentGridMm) * deploymentGridMm - padding;
    const xMax =
      Math.ceil((deploymentViewBox.x + deploymentViewBox.width) / deploymentGridMm) * deploymentGridMm + padding;
    const yMin = Math.floor(deploymentViewBox.y / deploymentGridMm) * deploymentGridMm - padding;
    const yMax =
      Math.ceil((deploymentViewBox.y + deploymentViewBox.height) / deploymentGridMm) * deploymentGridMm + padding;

    for (let x = xMin; x <= xMax; x += deploymentGridMm) {
      vertical.push(x);
    }
    for (let y = yMin; y <= yMax; y += deploymentGridMm) {
      horizontal.push(y);
    }
    return { vertical, horizontal, xMin, xMax, yMin, yMax };
  }, [deploymentViewBox]);
  const deployedDevices = useMemo(
    () => boundDevices.filter((device) => deploymentPlacements[device.id]),
    [boundDevices, deploymentPlacements],
  );
  const selectedDeploymentDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeploymentDeviceId) ?? null,
    [devices, selectedDeploymentDeviceId],
  );
  const selectedDeploymentPlacement = selectedDeploymentDeviceId
    ? deploymentPlacements[selectedDeploymentDeviceId] ?? null
    : null;
  const activeStepIndex = Math.max(
    configSteps.findIndex((step) => step.id === activeStep),
    0,
  );
  const previousConfigStep = configSteps[activeStepIndex - 1] ?? null;
  const nextConfigStep = configSteps[activeStepIndex + 1] ?? null;

  useEffect(() => {
    if (rangeMode !== "custom" || customRangeConfirmed || !customRangePreviewPoint) {
      return undefined;
    }

    const clearPreviewWhenOutsideChart = (event: globalThis.PointerEvent) => {
      const rect = rangeChartRef.current?.getBoundingClientRect();
      if (!rect?.width || !rect.height) {
        return;
      }

      const viewX = ((event.clientX - rect.left) / rect.width) * rangePreviewViewBoxWidth;
      const viewY = ((event.clientY - rect.top) / rect.height) * rangePreviewViewBoxHeight;
      const chartX = viewX - rangePreviewPadding.left;
      const chartY = viewY - rangePreviewPadding.top;
      if (chartX < 0 || chartX > rangePreviewWidth || chartY < 0 || chartY > rangePreviewHeight) {
        setCustomRangePreviewPoint(null);
      }
    };

    window.addEventListener("pointermove", clearPreviewWhenOutsideChart);
    return () => window.removeEventListener("pointermove", clearPreviewWhenOutsideChart);
  }, [customRangeConfirmed, customRangePreviewPoint, rangeMode]);

  useEffect(() => {
    if (!tagRegions.length) {
      setSelectedTagRegionId(null);
      return;
    }

    if (!tagRegions.some((region) => region.id === selectedTagRegionId)) {
      setSelectedTagRegionId(tagRegions[0].id);
    }
  }, [selectedTagRegionId, tagRegions]);

  useEffect(() => {
    setMcuBindings((prev) =>
      prev.map((binding) => {
        if (binding.tagRegionId == null) {
          return binding;
        }

        const matchedRegion = tagRegions.find((region) => region.id === binding.tagRegionId);
        if (!matchedRegion || matchedRegion.tagType !== "state") {
          return { ...binding, tagRegionId: null };
        }

        return binding;
      }),
    );
  }, [tagRegions]);

  useEffect(() => {
    let mounted = true;

    const loadSavedDevices = async () => {
      try {
        const saved = await fetchC4004Devices();
        if (!mounted || !saved.ok) {
          return;
        }

        if (saved.devices.length) {
          setDevices(saved.devices);
          setSelectedDeviceId((current) =>
            current && saved.devices.some((device) => device.id === current) ? current : saved.devices[0].id,
          );
          setScanState("done");
        } else {
          setScanState("idle");
        }
      } catch (err) {
        if (!mounted) {
          return;
        }
        setScanState("idle");
        setError(err instanceof Error ? `读取已保存设备失败：${err.message}` : "读取已保存设备失败");
      }
    };

    void loadSavedDevices();

    return () => {
      mounted = false;
    };
  }, []);

  const applyDeviceList = (nextDevices: ManagedDevice[], preferredDeviceId?: string | null) => {
    setDevices(nextDevices);
    setSelectedDeviceId((current) => {
      if (preferredDeviceId && nextDevices.some((device) => device.id === preferredDeviceId)) {
        return preferredDeviceId;
      }
      if (current && nextDevices.some((device) => device.id === current)) {
        return current;
      }
      return nextDevices[0]?.id ?? null;
    });
  };

  const persistDevicePatch = async (deviceId: string, patch: StoredC4004DevicePatch) => {
    if (deviceId.startsWith("mock-")) {
      return;
    }

    try {
      const result = await updateC4004Device(deviceId, patch);
      if (result.ok && result.device) {
        setDevices((prev) => prev.map((device) => (device.id === deviceId ? result.device! : device)));
      }
    } catch (err) {
      setError(err instanceof Error ? `保存设备状态失败：${err.message}` : "保存设备状态失败");
    }
  };

  const getDeploymentPointFromPointer = (event: { clientX: number; clientY: number }): DeploymentPoint | null => {
    return getDeploymentSvgPoint(event, deploymentCanvasRef.current);
  };

  const updateDeploymentZoom = (nextZoom: number) => {
    setDeploymentZoom(clampDeploymentZoom(nextZoom));
  };

  const resetDeploymentView = () => {
    setDeploymentZoom(1);
    setDeploymentPanOffset(deploymentWorldCenter);
  };

  const handleDeploymentWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    updateDeploymentZoom(deploymentZoom + delta);
  };

  const deployBoundDevice = (device: ManagedDevice) => {
    const offset = Object.keys(deploymentPlacements).length * 550;
    setDeploymentPlacements((prev) => ({
      ...prev,
      [device.id]: prev[device.id] ?? {
        deviceId: device.id,
        x: -1000 + offset,
        y: 1000,
        rotationDeg: -90,
        fovDeg: 90,
        rangeM: 6,
      },
    }));
    setSelectedDeploymentDeviceId(device.id);
    setPage("deployment");
    setMessage(`${device.name} 已添加到部署图`);
    setError(null);
  };

  const handleDeploymentCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!isDrawingDeploymentWall) {
      setDeploymentPanDrag({
        startClient: { x: event.clientX, y: event.clientY },
        baseOffset: deploymentPanOffset,
        viewBox: { width: deploymentViewBox.width, height: deploymentViewBox.height },
      });
      return;
    }

    const point = getDeploymentPointFromPointer(event);
    if (!point) {
      return;
    }

    const snapped = snapDeploymentPoint(point);
    if (!deploymentWallStart) {
      setDeploymentWallStart(snapped);
      setDeploymentWallPreview(snapped);
      return;
    }

    if (Math.hypot(snapped.x - deploymentWallStart.x, snapped.y - deploymentWallStart.y) < deploymentSnapMm) {
      return;
    }

    setDeploymentWalls((prev) => [
      ...prev,
      {
        id: Date.now(),
        start: deploymentWallStart,
        end: snapped,
      },
    ]);
    setDeploymentWallStart(snapped);
    setDeploymentWallPreview(snapped);
  };

  const handleDeploymentPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (deploymentPanDrag && !draggingDeploymentDeviceId && !isDrawingDeploymentWall) {
      const rect = deploymentCanvasRef.current?.getBoundingClientRect();
      if (!rect?.width || !rect.height) {
        return;
      }
      const dx = ((event.clientX - deploymentPanDrag.startClient.x) / rect.width) * deploymentPanDrag.viewBox.width;
      const dy = ((event.clientY - deploymentPanDrag.startClient.y) / rect.height) * deploymentPanDrag.viewBox.height;
      setDeploymentPanOffset({
        x: deploymentPanDrag.baseOffset.x - dx,
        y: deploymentPanDrag.baseOffset.y - dy,
      });
      return;
    }

    const point = getDeploymentPointFromPointer(event);
    if (!point) {
      return;
    }

    if (draggingDeploymentDeviceId) {
      const snapped = snapDeploymentPoint(point);
      setDeploymentPlacements((prev) => {
        const current = prev[draggingDeploymentDeviceId];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [draggingDeploymentDeviceId]: {
            ...current,
            x: snapped.x,
            y: snapped.y,
          },
        };
      });
      return;
    }

    if (isDrawingDeploymentWall && deploymentWallStart) {
      setDeploymentWallPreview(snapDeploymentPoint(point));
    }
  };

  const stopDeploymentInteractions = () => {
    setDraggingDeploymentDeviceId(null);
    setDeploymentPanDrag(null);
  };

  const startDraggingDeploymentDevice = (event: PointerEvent<SVGGElement>, deviceId: string) => {
    event.stopPropagation();
    setDraggingDeploymentDeviceId(deviceId);
    setSelectedDeploymentDeviceId(deviceId);
  };

  const updateDeploymentPlacement = (deviceId: string, patch: Partial<DeploymentPlacement>) => {
    setDeploymentPlacements((prev) => {
      const current = prev[deviceId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [deviceId]: {
          ...current,
          ...patch,
        },
      };
    });
  };

  const removeDeploymentWall = () => {
    setDeploymentWalls((prev) => prev.slice(0, -1));
    setDeploymentWallStart(null);
    setDeploymentWallPreview(null);
  };

  const clearDeployment = () => {
    setDeploymentWalls([]);
    setDeploymentPlacements({});
    setSelectedDeploymentDeviceId(null);
    setDeploymentWallStart(null);
    setDeploymentWallPreview(null);
    setIsDrawingDeploymentWall(false);
    resetDeploymentView();
  };

  const scanDevices = async () => {
    try {
      setScanState("scanning");
      setMessage(null);
      setError(null);

      const discovery = await discoverC4004Entities();
      if (!discovery.ok) {
        throw new Error(discovery.error ?? "设备扫描失败");
      }

      const savedDevices = discovery.devices ?? [];
      const nextDevices = savedDevices.length
        ? savedDevices
        : discovery.candidates.length
          ? discovery.candidates.map(toDevice)
          : [];
      const displayDevices = nextDevices.length ? nextDevices : devices;
      applyDeviceList(displayDevices);
      setScanState("done");
      setMessage(
        nextDevices.length
          ? `扫描完成，发现并保存 ${nextDevices.length} 个设备`
          : devices.length
            ? "未扫描到新的真实设备，继续显示已保存设备"
            : "未扫描到真实设备，请确认 Home Assistant 中 C4004 实体已接入",
      );
    } catch (err) {
      setScanState("error");
      setError(
        err instanceof Error
          ? devices.length
            ? `真实扫描失败，继续显示已保存设备：${err.message}`
            : `真实扫描失败：${err.message}`
          : "设备扫描失败",
      );
    }
  };

  const bindDevice = (device: ManagedDevice) => {
    setSelectedDeviceId(device.id);
    setDevices((prev) =>
      prev.map((item) => (item.id === device.id ? { ...item, bound: true } : item)),
    );
    void persistDevicePatch(device.id, { bound: true });
    setMessage(`${device.name} 已绑定`);
    setError(null);
  };

  const completeInitialization = () => {
    if (!selectedDevice) {
      return;
    }

    setDevices((prev) =>
      prev.map((item) =>
        item.id === selectedDevice.id ? { ...item, bound: true, initialized: true } : item,
      ),
    );
    void persistDevicePatch(selectedDevice.id, { bound: true, initialized: true });
    setMessage(`${selectedDevice.name} 已完成首次初始化`);
    setError(null);
    setPage("detail");
  };

  const enterDeviceConfig = (device: ManagedDevice) => {
    setSelectedDeviceId(device.id);
    setDetailConfigView("none");
    setPage("config");
    setActiveStep("bind");
    setMessage(null);
    setError(null);
  };

  const enterDeviceDetail = (device: ManagedDevice) => {
    setSelectedDeviceId(device.id);
    if (!device.initialized) {
      setPage("config");
      setActiveStep("bind");
      setMessage(`${device.name} 未进行第一次初始化，请先完成初始化流程`);
      setError(null);
      return;
    }

    setPage("detail");
    setDetailConfigView("none");
    setMessage(null);
    setError(null);
  };

  const openSelectedDeviceDetail = () => {
    if (selectedDevice) {
      enterDeviceDetail(selectedDevice);
      return;
    }

    setPage("detail");
  };

  const openConfigStep = (step: ConfigStepId) => {
    setDetailConfigView("none");
    setActiveStep(step);
    setPage("config");
    setMessage(null);
    setError(null);
  };

  const openDetailConfigView = (view: Exclude<DetailConfigView, "none">) => {
    setDetailConfigView(view);
    setMessage(null);
    setError(null);
  };

  const updateRangeConfig = (field: RangeField, value: string) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return;
    }
    setRangeConfig((prev) => ({ ...prev, [field]: nextValue }));
  };

  const applyRectRangeConfig = () => {
    setMessage("四方探测范围已设置");
    setError(null);
  };

  const applyLearnedRangeConfig = () => {
    if (!trackLearningEnabled) {
      setError("请先开启学习开关");
      setMessage(null);
      return;
    }

    setLearnedRangeModeEnabled(true);
    setMessage("已启用已学习的探测范围");
    setError(null);
  };

  const selectRangeMode = (mode: RangeMode) => {
    setRangeMode(mode);
    setCustomRangePreviewPoint(null);
  };

  const clearCustomRangePoints = () => {
    setCustomRangePreviewPoint(null);
    setCustomRangeConfirmed(false);
    setCustomRangeModeEnabled(false);
    setCustomRangePoints([]);
  };

  const undoCustomRangePoint = () => {
    if (customRangeConfirmed) {
      return;
    }

    setCustomRangePreviewPoint(null);
    setCustomRangePoints((prev) => prev.slice(0, -1));
  };

  const confirmCustomRange = () => {
    if (customRangePoints.length < 3) {
      return;
    }

    setCustomRangePreviewPoint(null);
    setCustomRangeConfirmed(true);
  };

  const enableCustomRangeMode = () => {
    if (!customRangeConfirmed || customRangePoints.length < 3) {
      return;
    }

    setCustomRangeModeEnabled(true);
    setMessage("已启用自定义范围模式");
    setError(null);
  };

  const getRangeSketchPoint = (event: PointerEvent<SVGElement>): RangeSketchPoint | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }

    const viewX = ((event.clientX - rect.left) / rect.width) * rangePreviewViewBoxWidth;
    const viewY = ((event.clientY - rect.top) / rect.height) * rangePreviewViewBoxHeight;
    const chartX = viewX - rangePreviewPadding.left;
    const chartY = viewY - rangePreviewPadding.top;
    if (chartX < 0 || chartX > rangePreviewWidth || chartY < 0 || chartY > rangePreviewHeight) {
      return null;
    }

    const x =
      rangePreviewXMinM + (chartX / rangePreviewWidth) * (rangePreviewXMaxM - rangePreviewXMinM);
    const y =
      rangePreviewYMinM +
      ((rangePreviewHeight - chartY) / rangePreviewHeight) * (rangePreviewYMaxM - rangePreviewYMinM);

    return {
      x: roundRangeSketchValue(x),
      y: roundRangeSketchValue(y),
    };
  };

  const handleCustomRangeCanvasClick = (event: PointerEvent<SVGElement>) => {
    if (rangeMode !== "custom" || customRangeConfirmed) {
      return;
    }

    const point = getRangeSketchPoint(event);
    if (!point) {
      setCustomRangePreviewPoint(null);
      return;
    }

    event.preventDefault();

    if (!customRangePoints.length) {
      setCustomRangePoints([point]);
      setCustomRangePreviewPoint(null);
      return;
    }

    const startPoint = customRangePoints[customRangePoints.length - 1];
    if (Math.hypot(point.x - startPoint.x, point.y - startPoint.y) < rangeSketchMinDistanceM) {
      return;
    }

    setCustomRangePreviewPoint(null);
    setCustomRangePoints((prev) => [...prev, point]);
  };

  const previewCustomRangeLine = (event: PointerEvent<SVGElement>) => {
    if (rangeMode !== "custom" || customRangeConfirmed || !customRangePoints.length) {
      return;
    }

    const point = getRangeSketchPoint(event);
    if (!point) {
      return;
    }

    setCustomRangePreviewPoint(point);
  };

  const stopCustomRangePreview = () => {
    setCustomRangePreviewPoint(null);
  };

  const getTrackingSketchPoint = (event: PointerEvent<SVGSVGElement>): RangeSketchPoint | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }

    const totalWidth = trackingCanvasWidth + trackingCanvasPadding * 2;
    const totalHeight = trackingCanvasHeight + trackingCanvasPadding * 2;
    const viewX = -trackingCanvasPadding + ((event.clientX - rect.left) / rect.width) * totalWidth;
    const viewY = -trackingCanvasPadding + ((event.clientY - rect.top) / rect.height) * totalHeight;
    const chartX = viewX;
    const chartY = viewY;

    if (chartX < 0 || chartX > trackingCanvasWidth || chartY < 0 || chartY > trackingCanvasHeight) {
      return null;
    }

    const xMm = trackingXMinMm + (chartX / trackingCanvasWidth) * trackingXRangeMm;
    const yMm = trackingYMinMm + ((trackingCanvasHeight - chartY) / trackingCanvasHeight) * trackingYRangeMm;

    return {
      x: roundRangeSketchValue(xMm / 1000),
      y: roundRangeSketchValue(yMm / 1000),
    };
  };

  const handleDetailCustomRangeCanvasClick = (event: PointerEvent<SVGSVGElement>) => {
    if (detailConfigView !== "range" || rangeMode !== "custom" || customRangeConfirmed) {
      return;
    }

    const point = getTrackingSketchPoint(event);
    if (!point) {
      setCustomRangePreviewPoint(null);
      return;
    }

    event.preventDefault();

    if (!customRangePoints.length) {
      setCustomRangePoints([point]);
      setCustomRangePreviewPoint(null);
      return;
    }

    const startPoint = customRangePoints[customRangePoints.length - 1];
    if (Math.hypot(point.x - startPoint.x, point.y - startPoint.y) < rangeSketchMinDistanceM) {
      return;
    }

    setCustomRangePreviewPoint(null);
    setCustomRangePoints((prev) => [...prev, point]);
  };

  const previewDetailCustomRangeLine = (event: PointerEvent<SVGSVGElement>) => {
    if (detailConfigView !== "range" || rangeMode !== "custom" || customRangeConfirmed || !customRangePoints.length) {
      return;
    }

    const point = getTrackingSketchPoint(event);
    if (!point) {
      return;
    }

    setCustomRangePreviewPoint(point);
  };

  const updateTagRegion = (id: number, field: TagRegionField, value: string) => {
    setTagRegions((prev) =>
      prev.map((region) => {
        if (region.id !== id) {
          return region;
        }

        if (field === "name") {
          return { ...region, name: value };
        }

        if (field === "tagType") {
          return { ...region, tagType: value as TagType };
        }

        if (field === "rangeShape") {
          const nextShape = value as TagRangeShape;
          const nextRegion =
            nextShape === "circle"
              ? {
                  ...region,
                  rangeShape: nextShape,
                  xSizeCm: Math.max(1, Math.round(Math.max(region.xSizeCm, region.ySizeCm) / 2)),
                }
              : {
                  ...region,
                  rangeShape: nextShape,
                  ySizeCm: region.ySizeCm > 0 ? region.ySizeCm : region.xSizeCm,
                };
          return syncTagRegionGeometry(nextRegion);
        }

        const nextValue = Number(value);
        if (!Number.isFinite(nextValue)) {
          return region;
        }

        if (field === "index" || field === "ioIndex") {
          return { ...region, [field]: clampTagIndex(nextValue) };
        }

        if (field === "xSizeCm" || field === "ySizeCm") {
          return syncTagRegionGeometry({ ...region, [field]: clampTagSizeCm(nextValue) });
        }

        return region;
      }),
    );
  };

  const addTagRegion = () => {
    setTagRegions((prev) => {
      const nextIndex = prev.length
        ? clampTagIndex(Math.max(...prev.map((region) => region.index)) + 1)
        : tagIndexMin;
      return [
        ...prev,
        {
          id: Date.now(),
          name: tagNameOptions[(nextIndex - 1) % tagNameOptions.length],
          tagType: "none",
          rangeShape: "rect",
          index: nextIndex,
          ioIndex: nextIndex,
          xSizeCm: 160,
          ySizeCm: 180,
          xMin: -1,
          xMax: 0.6,
          yMin: 1,
          yMax: 2.8,
        },
      ];
    });
  };

  const updateMcuBinding = (zoneId: number, field: "mcuIo" | "tagRegionId", value: string) => {
    setMcuBindings((prev) =>
      prev.map((binding) => {
        if (binding.zoneId !== zoneId) {
          return binding;
        }

        if (field === "mcuIo") {
          if (!value) {
            return { ...binding, mcuIo: null };
          }

          const nextIo = Number(value);
          return Number.isFinite(nextIo) ? { ...binding, mcuIo: nextIo } : binding;
        }

        return {
          ...binding,
          tagRegionId: value ? Number(value) : null,
        };
      }),
    );
  };

  const removeTagRegion = (id: number) => {
    setTagRegions((prev) => prev.filter((region) => region.id !== id));
  };

  const clearAllTagRegions = () => {
    setTagRegions([]);
  };

  const updateTrackingZoneShape = (zoneId: number, shape: TrackingZoneShape) => {
    setTrackingZones((prev) => prev.map((zone) => (zone.id === zoneId ? { ...zone, shape } : zone)));
  };

  const updateTrackingZoneField = (zoneId: number, field: TrackingZoneField, value: string) => {
    if (value.trim() === "") {
      return;
    }

    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return;
    }

    setTrackingZones((prev) =>
      prev.map((zone) =>
        zone.id === zoneId ? { ...zone, [field]: clampTrackingField(field, nextValue * 1000) } : zone,
      ),
    );
  };

  const goToPreviousConfigStep = () => {
    if (previousConfigStep) {
      setActiveStep(previousConfigStep.id);
    }
  };

  const goToNextConfigStep = () => {
    if (nextConfigStep) {
      setActiveStep(nextConfigStep.id);
    }
  };

  const renderStepNavigation = (leadingAction?: ReactNode, finalAction?: ReactNode) => (
    <div className="flow-actions">
      <div className="flow-actions-leading">{leadingAction}</div>
      <div className="flow-actions-nav">
        <button
          type="button"
          className="action-button"
          disabled={!previousConfigStep}
          onClick={goToPreviousConfigStep}
        >
          上一步
        </button>
        {nextConfigStep ? (
          <button type="button" className="action-button action-primary" onClick={goToNextConfigStep}>
            下一步：{nextConfigStep.title}
          </button>
        ) : (
          finalAction
        )}
      </div>
    </div>
  );

  const renderTagCoordinatePreview = () => {
    const rangeGridLines: ReactNode[] = [];
    const rangeTickLabels: ReactNode[] = [];

    for (let x = rangePreviewXMinM; x <= rangePreviewXMaxM; x += rangePreviewGridM) {
      const xPos = toRangePreviewX(x);
      rangeGridLines.push(
        <line
          className={x === 0 ? "range-chart-axis" : "range-chart-grid"}
          key={`tag-range-x-${x}`}
          x1={xPos}
          x2={xPos}
          y1={0}
          y2={rangePreviewHeight}
          vectorEffect="non-scaling-stroke"
        />,
      );
      rangeTickLabels.push(
        <text className="range-chart-label" key={`tag-range-x-label-${x}`} x={xPos} y={rangePreviewHeight + 30}>
          {x}m
        </text>,
      );
    }

    for (let y = rangePreviewYMinM; y <= rangePreviewYMaxM; y += rangePreviewGridM) {
      const yPos = toRangePreviewY(y);
      rangeGridLines.push(
        <line
          className={y === 0 ? "range-chart-axis" : "range-chart-grid"}
          key={`tag-range-y-${y}`}
          x1={0}
          x2={rangePreviewWidth}
          y1={yPos}
          y2={yPos}
          vectorEffect="non-scaling-stroke"
        />,
      );
      rangeTickLabels.push(
        <text className="range-chart-label range-chart-y-label" key={`tag-range-y-label-${y}`} x={-14} y={yPos + 5}>
          {y}m
        </text>,
      );
    }

    const rangeLeftInput = Math.min(rangeConfig.xMin, rangeConfig.xMax) / 100;
    const rangeRightInput = Math.max(rangeConfig.xMin, rangeConfig.xMax) / 100;
    const rangeBottomInput = Math.min(rangeConfig.yMin, rangeConfig.yMax) / 100;
    const rangeTopInput = Math.max(rangeConfig.yMin, rangeConfig.yMax) / 100;
    const rangeLeftM = clampRangePreviewValue(rangeLeftInput, rangePreviewXMinM, rangePreviewXMaxM);
    const rangeRightM = clampRangePreviewValue(rangeRightInput, rangePreviewXMinM, rangePreviewXMaxM);
    const rangeBottomM = clampRangePreviewValue(rangeBottomInput, rangePreviewYMinM, rangePreviewYMaxM);
    const rangeTopM = clampRangePreviewValue(rangeTopInput, rangePreviewYMinM, rangePreviewYMaxM);
    const rangeRectLeft = Math.min(toRangePreviewX(rangeLeftM), toRangePreviewX(rangeRightM));
    const rangeRectRight = Math.max(toRangePreviewX(rangeLeftM), toRangePreviewX(rangeRightM));
    const rangeRectTop = Math.min(toRangePreviewY(rangeTopM), toRangePreviewY(rangeBottomM));
    const rangeRectBottom = Math.max(toRangePreviewY(rangeTopM), toRangePreviewY(rangeBottomM));
    const customRangeChartPoints = customRangePoints.map(toRangePreviewPoint);
    const learnedRangeChartPoints = learnedRangePoints.map(toRangePreviewPoint);

    return (
      <div className="range-preview tag-coordinate-preview">
        <svg
          className="range-chart"
          viewBox={`0 0 ${rangePreviewViewBoxWidth} ${rangePreviewViewBoxHeight}`}
          role="img"
          aria-label="标签区域坐标配置"
        >
          <g transform={`translate(${rangePreviewPadding.left}, ${rangePreviewPadding.top})`}>
            <rect className="range-chart-background" x={0} y={0} width={rangePreviewWidth} height={rangePreviewHeight} />
            {rangeGridLines}
            {rangeMode === "rect" && (
              <rect
                className="range-detection-area"
                x={rangeRectLeft}
                y={rangeRectTop}
                width={rangeRectRight - rangeRectLeft}
                height={rangeRectBottom - rangeRectTop}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {rangeMode === "learned" && learnedRangeChartPoints.length >= 3 && (
              <polygon
                className="range-learned-polygon"
                points={formatRangeSketchPoints(learnedRangeChartPoints)}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {rangeMode === "learned" && learnedRangeChartPoints.map((point, index) => (
              <g className="range-learned-vertex" key={`tag-learned-${point.x}-${point.y}-${index}`}>
                <circle cx={point.x} cy={point.y} r="10" vectorEffect="non-scaling-stroke" />
              </g>
            ))}
            {rangeMode === "custom" && customRangeChartPoints.length >= 3 && (
              <polygon
                className="range-custom-polygon"
                points={formatRangeSketchPoints(customRangeChartPoints)}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {rangeMode === "custom" && customRangeChartPoints.length > 1 && (
              <polyline
                className="range-custom-line"
                points={formatRangeSketchPoints(customRangeChartPoints)}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {tagRegions.map((region) => {
              const left = Math.min(toRangePreviewX(region.xMin), toRangePreviewX(region.xMax));
              const right = Math.max(toRangePreviewX(region.xMin), toRangePreviewX(region.xMax));
              const top = Math.min(toRangePreviewY(region.yMax), toRangePreviewY(region.yMin));
              const bottom = Math.max(toRangePreviewY(region.yMax), toRangePreviewY(region.yMin));
              const centerM = {
                x: (region.xMin + region.xMax) / 2,
                y: (region.yMin + region.yMax) / 2,
              };
              const centerX = (left + right) / 2;
              const centerY = (top + bottom) / 2;
              const circleRadius = Math.abs(toRangePreviewX(centerM.x + region.xSizeCm / 100) - toRangePreviewX(centerM.x));

              return (
                <g className="tag-region-shape" key={region.id}>
                  {region.rangeShape === "circle" ? (
                    <circle cx={centerX} cy={centerY} r={circleRadius} vectorEffect="non-scaling-stroke" />
                  ) : (
                    <rect
                      x={left}
                      y={top}
                      width={right - left}
                      height={bottom - top}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <text x={centerX} y={centerY - 4}>
                    <tspan x={centerX}>{region.name}</tspan>
                    <tspan x={centerX} dy="22">
                      IDX {region.index}
                    </tspan>
                  </text>
                </g>
              );
            })}
            <g
              aria-hidden="true"
              className="range-radar-origin"
              transform={`translate(${toRangePreviewX(0)}, ${toRangePreviewY(0)})`}
            >
              <path className="range-radar-wave" d="M -64 -24 Q 0 -88 64 -24" />
              <path className="range-radar-wave" d="M -44 -16 Q 0 -58 44 -16" />
              <path className="range-radar-wave" d="M -24 -9 Q 0 -32 24 -9" />
              <circle className="range-radar-dot" cx="0" cy="0" r="8" />
            </g>
            {rangeTickLabels}
            <text className="range-chart-axis-title" x={rangePreviewWidth + 22} y={rangePreviewHeight + 6}>
              X
            </text>
            <text className="range-chart-axis-title" x={toRangePreviewX(0) + 14} y={-14}>
              Y
            </text>
          </g>
        </svg>
      </div>
    );
  };

  const renderSidebar = () => (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">C4</span>
        <div className="brand-copy">
          <strong>DFRobot C4004</strong>
          <small>毫米波雷达控制台</small>
        </div>
      </div>

      <nav className="side-nav" aria-label="主导航">
        <button
          type="button"
          className={page === "management" ? "nav-item nav-item-active" : "nav-item"}
          onClick={() => setPage("management")}
        >
          设备管理
        </button>
        <button
          type="button"
          className={page === "deployment" ? "nav-item nav-item-active" : "nav-item"}
          onClick={() => setPage("deployment")}
        >
          设备部署
        </button>
        <button
          type="button"
          className={page === "detail" ? "nav-item nav-item-active" : "nav-item"}
          onClick={openSelectedDeviceDetail}
        >
          设备详情展示
        </button>
      </nav>
    </aside>
  );

  const renderTagRegionFieldGrid = (region: TagRegion) => (
    <div className="tag-region-input-grid">
      <label className="form-field">
        <span>标签名称</span>
        <select value={region.name} onChange={(event) => updateTagRegion(region.id, "name", event.target.value)}>
          {tagNameOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>标签类型</span>
        <select value={region.tagType} onChange={(event) => updateTagRegion(region.id, "tagType", event.target.value)}>
          {tagTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>范围类型</span>
        <select value={region.rangeShape} onChange={(event) => updateTagRegion(region.id, "rangeShape", event.target.value)}>
          {tagRangeShapeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>标签索引</span>
        <input
          type="number"
          min={tagIndexMin}
          max={tagIndexMax}
          step="1"
          value={region.index}
          onChange={(event) => updateTagRegion(region.id, "index", event.target.value)}
        />
      </label>
      <label className="form-field">
        <span>IO 索引</span>
        <input
          type="number"
          min={tagIndexMin}
          max={tagIndexMax}
          step="1"
          value={region.ioIndex}
          onChange={(event) => updateTagRegion(region.id, "ioIndex", event.target.value)}
        />
      </label>
      <label className="form-field">
        <span>{region.rangeShape === "circle" ? "X 半径(cm)" : "X 宽(cm)"}</span>
        <input
          type="number"
          step="1"
          value={Math.round(region.xSizeCm)}
          onChange={(event) => updateTagRegion(region.id, "xSizeCm", event.target.value)}
        />
      </label>
      <label className={region.rangeShape === "circle" ? "form-field form-field-readonly" : "form-field"}>
        <span>{region.rangeShape === "circle" ? "Y 高(cm) 无效" : "Y 高(cm)"}</span>
        <input
          type="number"
          step="1"
          value={region.rangeShape === "circle" ? "" : Math.round(region.ySizeCm)}
          placeholder={region.rangeShape === "circle" ? "无效" : undefined}
          disabled={region.rangeShape === "circle"}
          onChange={(event) => updateTagRegion(region.id, "ySizeCm", event.target.value)}
        />
      </label>
    </div>
  );

  const renderRangeConfigSection = (showPreview = true) => {
    const rangeGridLines: ReactNode[] = [];
    const rangeTickLabels: ReactNode[] = [];
    const rangeLeftInput = Math.min(rangeConfig.xMin, rangeConfig.xMax) / 100;
    const rangeRightInput = Math.max(rangeConfig.xMin, rangeConfig.xMax) / 100;
    const rangeBottomInput = Math.min(rangeConfig.yMin, rangeConfig.yMax) / 100;
    const rangeTopInput = Math.max(rangeConfig.yMin, rangeConfig.yMax) / 100;
    const rangeWidthM = Math.max(rangeRightInput - rangeLeftInput, 0);
    const rangeHeightM = Math.max(rangeTopInput - rangeBottomInput, 0);
    const rangeSamplePoints = [
      { x: rangeLeftInput + rangeWidthM * 0.28, y: rangeBottomInput + rangeHeightM * 0.72 },
      { x: rangeLeftInput + rangeWidthM * 0.68, y: rangeBottomInput + rangeHeightM * 0.58 },
      { x: rangeLeftInput + rangeWidthM * 0.46, y: rangeBottomInput + rangeHeightM * 0.28 },
    ];

    for (let x = rangePreviewXMinM; x <= rangePreviewXMaxM; x += rangePreviewGridM) {
      const xPos = toRangePreviewX(x);
      rangeGridLines.push(
        <line
          className={x === 0 ? "range-chart-axis" : "range-chart-grid"}
          key={`range-x-${x}`}
          x1={xPos}
          x2={xPos}
          y1={0}
          y2={rangePreviewHeight}
          vectorEffect="non-scaling-stroke"
        />,
      );
      rangeTickLabels.push(
        <text className="range-chart-label" key={`range-x-label-${x}`} x={xPos} y={rangePreviewHeight + 30}>
          {x}m
        </text>,
      );
    }

    for (let y = rangePreviewYMinM; y <= rangePreviewYMaxM; y += rangePreviewGridM) {
      const yPos = toRangePreviewY(y);
      rangeGridLines.push(
        <line
          className={y === 0 ? "range-chart-axis" : "range-chart-grid"}
          key={`range-y-${y}`}
          x1={0}
          x2={rangePreviewWidth}
          y1={yPos}
          y2={yPos}
          vectorEffect="non-scaling-stroke"
        />,
      );
      rangeTickLabels.push(
        <text className="range-chart-label range-chart-y-label" key={`range-y-label-${y}`} x={-14} y={yPos + 5}>
          {y}m
        </text>,
      );
    }

    const rangeLeftM = clampRangePreviewValue(rangeLeftInput, rangePreviewXMinM, rangePreviewXMaxM);
    const rangeRightM = clampRangePreviewValue(rangeRightInput, rangePreviewXMinM, rangePreviewXMaxM);
    const rangeBottomM = clampRangePreviewValue(rangeBottomInput, rangePreviewYMinM, rangePreviewYMaxM);
    const rangeTopM = clampRangePreviewValue(rangeTopInput, rangePreviewYMinM, rangePreviewYMaxM);
    const rangeRectLeft = Math.min(toRangePreviewX(rangeLeftM), toRangePreviewX(rangeRightM));
    const rangeRectRight = Math.max(toRangePreviewX(rangeLeftM), toRangePreviewX(rangeRightM));
    const rangeRectTop = Math.min(toRangePreviewY(rangeTopM), toRangePreviewY(rangeBottomM));
    const rangeRectBottom = Math.max(toRangePreviewY(rangeTopM), toRangePreviewY(rangeBottomM));
    const customRangeChartPoints = customRangePoints.map(toRangePreviewPoint);
    const learnedRangeChartPoints = learnedRangePoints.map(toRangePreviewPoint);
    const customRangePreviewChartPoints =
      customRangePreviewPoint && customRangePoints.length
        ? [customRangePoints[customRangePoints.length - 1], customRangePreviewPoint].map(toRangePreviewPoint)
        : [];
    const liveCustomRangeChartPoints =
      !customRangeConfirmed && customRangePreviewPoint && customRangePoints.length >= 2
        ? [...customRangePoints, customRangePreviewPoint].map(toRangePreviewPoint)
        : !customRangeConfirmed && customRangePoints.length >= 3
          ? customRangeChartPoints
          : [];
    return (
      <div className="config-section">
        <div className="section-title">
          <h2>探测范围配置</h2>
        </div>
        <div className={showPreview ? "range-layout" : "range-layout range-layout-panel"}>
          {showPreview ? (
          <div className="range-preview">
            <svg
              ref={rangeChartRef}
              className={rangeMode === "custom" && !customRangeConfirmed ? "range-chart range-chart-sketch-enabled" : "range-chart"}
              viewBox={`0 0 ${rangePreviewViewBoxWidth} ${rangePreviewViewBoxHeight}`}
              onPointerDown={handleCustomRangeCanvasClick}
              onPointerMove={previewCustomRangeLine}
              onPointerLeave={stopCustomRangePreview}
              onMouseLeave={stopCustomRangePreview}
              role="img"
              aria-label="探测范围坐标轴，X 轴从 -5m 到 5m，Y 轴从 0m 到 9m"
            >
              <rect
                className="range-chart-event-layer"
                x={0}
                y={0}
                width={rangePreviewViewBoxWidth}
                height={rangePreviewViewBoxHeight}
                onPointerMove={previewCustomRangeLine}
              />
              <g transform={`translate(${rangePreviewPadding.left}, ${rangePreviewPadding.top})`}>
                <rect className="range-chart-background" x={0} y={0} width={rangePreviewWidth} height={rangePreviewHeight} />
                {rangeGridLines}
                {rangeMode === "rect" ? (
                  <rect
                    className="range-detection-area"
                    x={rangeRectLeft}
                    y={rangeRectTop}
                    width={rangeRectRight - rangeRectLeft}
                    height={rangeRectBottom - rangeRectTop}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {rangeSamplePoints.map((point, index) => {
                  const previewPoint = toRangePreviewPoint({
                    x: clampRangePreviewValue(point.x, rangePreviewXMinM, rangePreviewXMaxM),
                    y: clampRangePreviewValue(point.y, rangePreviewYMinM, rangePreviewYMaxM),
                  });
                  return (
                    <circle
                      className="range-chart-dot"
                      cx={previewPoint.x}
                      cy={previewPoint.y}
                      key={`${point.x}-${point.y}-${index}`}
                      r="10"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
                {rangeMode === "learned" && learnedRangeChartPoints.length >= 3 ? (
                  <polygon
                    className="range-learned-polygon"
                    points={formatRangeSketchPoints(learnedRangeChartPoints)}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {rangeMode === "learned"
                  ? learnedRangeChartPoints.map((point, index) => (
                      <g className="range-learned-vertex" key={`learned-${point.x}-${point.y}-${index}`}>
                        <circle cx={point.x} cy={point.y} r="10" vectorEffect="non-scaling-stroke" />
                      </g>
                    ))
                  : null}
                {rangeMode === "custom" && liveCustomRangeChartPoints.length >= 3 ? (
                  <polygon
                    className="range-custom-polygon-preview"
                    points={formatRangeSketchPoints(liveCustomRangeChartPoints)}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {rangeMode === "custom" && customRangeConfirmed && customRangeChartPoints.length >= 3 ? (
                  <polygon
                    className="range-custom-polygon"
                    points={formatRangeSketchPoints(customRangeChartPoints)}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {rangeMode === "custom" && customRangeChartPoints.length > 1 ? (
                  <polyline
                    className="range-custom-line"
                    points={formatRangeSketchPoints(customRangeChartPoints)}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {rangeMode === "custom" && customRangePreviewChartPoints.length > 1 ? (
                  <polyline
                    className="range-custom-line range-custom-line-draft"
                    points={formatRangeSketchPoints(customRangePreviewChartPoints)}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {rangeMode === "custom"
                  ? customRangeChartPoints.map((point, index) => (
                      <g className="range-custom-vertex" key={`${point.x}-${point.y}-${index}`}>
                        <circle cx={point.x} cy={point.y} r="12" vectorEffect="non-scaling-stroke" />
                        <text x={point.x} y={point.y + 4}>
                          {index + 1}
                        </text>
                      </g>
                    ))
                  : null}
                <g
                  aria-hidden="true"
                  className="range-radar-origin"
                  transform={`translate(${toRangePreviewX(0)}, ${toRangePreviewY(0)})`}
                >
                  <path className="range-radar-wave" d="M -64 -24 Q 0 -88 64 -24" />
                  <path className="range-radar-wave" d="M -44 -16 Q 0 -58 44 -16" />
                  <path className="range-radar-wave" d="M -24 -9 Q 0 -32 24 -9" />
                  <circle className="range-radar-dot" cx="0" cy="0" r="8" />
                </g>
                {rangeTickLabels}
                <text className="range-chart-axis-title" x={rangePreviewWidth + 22} y={rangePreviewHeight + 6}>
                  X
                </text>
                <text className="range-chart-axis-title" x={toRangePreviewX(0) + 14} y={-14}>
                  Y
                </text>
              </g>
            </svg>
          </div>
          ) : null}

          <div className="range-controls">
            <div className="range-mode-selector" aria-label="探测范围显示模式">
              <button
                type="button"
                className={rangeMode === "rect" ? "range-mode-button range-mode-button-active" : "range-mode-button"}
                onClick={() => selectRangeMode("rect")}
              >
                四方探测范围模式
              </button>
              <button
                type="button"
                className={rangeMode === "learned" ? "range-mode-button range-mode-button-active" : "range-mode-button"}
                onClick={() => selectRangeMode("learned")}
              >
                轨迹探测范围模式
              </button>
              <button
                type="button"
                className={rangeMode === "custom" ? "range-mode-button range-mode-button-active" : "range-mode-button"}
                onClick={() => selectRangeMode("custom")}
              >
                自定义轨迹范围模式              </button>
            </div>

            <div className="range-mode-panel">
              {rangeMode === "rect" ? (
                <>
                  <div className="field-grid">
                    {rangeConfigFields.map(({ field, label }) => (
                      <label className="form-field" key={field}>
                        <span>{label}</span>
                        <input
                          type="number"
                          step="1"
                          value={rangeConfig[field]}
                          onChange={(event) => updateRangeConfig(field, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="range-mode-actions">
                    <button type="button" className="action-button action-primary" onClick={applyRectRangeConfig}>
                      设置
                    </button>
                  </div>
                </>
              ) : null}

              {rangeMode === "learned" ? (
                <>
                  <div className="feature-row">
                    <div>
                      <strong>开启 / 关闭学习探测范围开关</strong>
                      <span>打开后设备进入轨迹学习流程。</span>
                    </div>
                    <button
                      type="button"
                      className={trackLearningEnabled ? "switch switch-on" : "switch"}
                      onClick={() => setTrackLearningEnabled((prev) => !prev)}
                      aria-pressed={trackLearningEnabled}
                      >
                        <span />
                      </button>
                    </div>
                  {showPreview ? (
                    <div className="range-mode-actions">
                      <button
                        type="button"
                        className="action-button action-primary"
                        onClick={applyLearnedRangeConfig}
                      >
                        设置
                      </button>
                    </div>
                  ) : null}
                  {!showPreview ? (
                    <div className="range-mode-actions">
                      <button type="button" className="action-button action-primary" onClick={applyLearnedRangeConfig}>
                        设置
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}

              {rangeMode === "custom" ? (
                <>
                  <div className="range-custom-toolbar">
                    <span className={customRangePoints.length ? "state-chip state-chip-on" : "state-chip"}>
                      {customRangeConfirmed
                        ? customRangeModeEnabled
                          ? `已启用自定义范围 ${customRangePoints.length} 点`
                          : `设置已完成 ${customRangePoints.length} 点`
                        : customRangePoints.length >= 3
                          ? `临时范围 ${customRangePoints.length} 点，确认前可继续添加`
                          : customRangePoints.length
                            ? `待选择第 ${customRangePoints.length + 1} 点`
                            : "点击坐标系设置起点"}
                    </span>
                    <div>
                      <button
                        type="button"
                        className="range-tool-button range-tool-button-primary"
                        disabled={customRangePoints.length < 3 || customRangeConfirmed}
                        onClick={confirmCustomRange}
                      >
                        设置完成确认
                      </button>
                      <button
                        type="button"
                        className="range-tool-button"
                        disabled={!customRangePoints.length || customRangeConfirmed}
                        onClick={undoCustomRangePoint}
                      >
                        撤销
                      </button>
                      <button
                        type="button"
                        className="range-tool-button"
                        disabled={!customRangePoints.length}
                        onClick={clearCustomRangePoints}
                      >
                        清除
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="range-enable-button"
                    disabled={!customRangeConfirmed || customRangeModeEnabled}
                    onClick={enableCustomRangeMode}
                  >
                    设置
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderDetailTagConfigPanel = (showPreview = true) => (
    <div className="config-section">
      <div className="section-title">
        <h2>标签配置</h2>
      </div>
      <div className={showPreview ? "detail-tag-config-layout" : "detail-tag-config-layout detail-tag-config-layout-single"}>
        {showPreview ? renderTagCoordinatePreview() : null}
        <div className="tag-region-panel detail-tag-config-panel">
          <div className="tag-region-panel-heading">
            <strong>标签配置</strong>
            <button type="button" className="range-tool-button" onClick={addTagRegion}>
              新增区域
            </button>
          </div>
          <div className="detail-tag-config-toolbar">
            <label className="form-field">
              <span>选择标签</span>
              <select
                value={selectedTagRegion?.id ?? ""}
                onChange={(event) => setSelectedTagRegionId(event.target.value ? Number(event.target.value) : null)}
                disabled={!tagRegions.length}
              >
                {tagRegions.length ? (
                  tagRegions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name} / IDX {region.index}
                    </option>
                  ))
                ) : (
                  <option value="">暂无标签</option>
                )}
              </select>
            </label>
            <div className="detail-button-row">
              <button
                type="button"
                className="range-tool-button"
                disabled={!selectedTagRegion}
                onClick={() => {
                  if (selectedTagRegion) {
                    removeTagRegion(selectedTagRegion.id);
                  }
                }}
              >
                清除当前标签
              </button>
              <button
                type="button"
                className="range-tool-button"
                disabled={!tagRegions.length}
                onClick={clearAllTagRegions}
              >
                清除所有标签
              </button>
            </div>
          </div>
          {selectedTagRegion ? (
            <div className="tag-region-editor detail-tag-region-editor-single">
              <div className="tag-region-editor-title">
                <strong>{selectedTagRegion.name}</strong>
                <span>IDX {selectedTagRegion.index} / IO {selectedTagRegion.ioIndex}</span>
              </div>
              {renderTagRegionFieldGrid(selectedTagRegion)}
            </div>
          ) : (
            <div className="detail-tag-empty">
              <strong>暂无标签区域</strong>
              <span>点击“新增区域”后开始配置。</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderDetailMcuConfigPanel = () => (
    <div className="config-section">
      <div className="section-title">
        <h2>MCU配置</h2>
      </div>
      <div className="config-note">
        <strong>绑定规则</strong>
        <span>区域1固定为整区有人/无人，Zone2-6 仅可绑定状态类标签。</span>
      </div>
      <div className="mcu-fixed-card">
        <div className="mcu-fixed-card-header">
          <strong>区域1</strong>
        </div>
        {(() => {
          const zoneOneBinding = mcuBindings.find((binding) => binding.zoneId === 1) ?? null;

          return (
        <div className="field-grid">
          <label className="form-field form-field-readonly">
            <span>绑定来源</span>
            <input value="整个探测范围" readOnly />
          </label>
          <label className="form-field form-field-readonly">
            <span>传感器IO</span>
            <input value="固定整区状态" readOnly />
          </label>
          <label className="form-field">
            <span>单片机IO</span>
            <select
              value={zoneOneBinding?.mcuIo ?? ""}
              onChange={(event) => updateMcuBinding(1, "mcuIo", event.target.value)}
            >
              <option value="">未绑定</option>
              {initialMcuBindings.map((option) => (
                <option key={option.zoneId} value={option.zoneId}>
                  MCU IO {option.zoneId}
                </option>
              ))}
            </select>
          </label>
        </div>
          );
        })()}
      </div>
      <div className="mcu-binding-list">
        {mcuBindings.filter((binding) => binding.zoneId >= 2).map((binding) => {
          const boundRegion = stateTagRegions.find((region) => region.id === binding.tagRegionId) ?? null;

          return (
            <div className="mcu-binding-card" key={binding.zoneId}>
              <div className="mcu-binding-card-header">
                <strong>Zone {binding.zoneId}</strong>
              </div>
              <div className="tag-grid">
                <label className="form-field">
                  <span>统计标签</span>
                  <select
                    value={binding.tagRegionId ?? ""}
                    onChange={(event) => updateMcuBinding(binding.zoneId, "tagRegionId", event.target.value)}
                  >
                    <option value="">未绑定</option>
                    {stateTagRegions.map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.name} / IDX {region.index}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>单片机IO</span>
                  <select
                    value={binding.mcuIo ?? ""}
                    onChange={(event) => updateMcuBinding(binding.zoneId, "mcuIo", event.target.value)}
                  >
                    <option value="">未绑定</option>
                    {initialMcuBindings.map((option) => (
                      <option key={option.zoneId} value={option.zoneId}>
                        MCU IO {option.zoneId}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field form-field-readonly">
                  <span>传感器IO</span>
                  <input value={boundRegion ? `IO ${boundRegion.ioIndex}` : "未绑定"} readOnly />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderDetailParameterConfigPanel = () => (
    <div className="detail-param-editor-layout">
      <div className="config-section">
        <div className="section-title">
          <h2>人数统计参数设置</h2>
        </div>
        <div className="feature-list">
          <div className="feature-row">
            <div>
              <strong>人体存在使能</strong>
            </div>
            <button
              type="button"
              className={presenceEnabled ? "switch switch-on" : "switch"}
              onClick={() => setPresenceEnabled((prev) => !prev)}
              aria-pressed={presenceEnabled}
            >
              <span />
            </button>
          </div>
          <div className="feature-row">
            <div>
              <strong>轨迹跟踪使能</strong>
            </div>
            <button
              type="button"
              className={trackingEnabled ? "switch switch-on" : "switch"}
              onClick={() => setTrackingEnabled((prev) => !prev)}
              aria-pressed={trackingEnabled}
            >
              <span />
            </button>
          </div>
        </div>
        <div className="detail-settings-grid">
          <label className="form-field">
            <span>实时人数上报时间(/s)</span>
            <input type="number" step="1" min="1" value={realTimePeopleTime} onChange={(event) => setRealTimePeopleTime(event.target.value)} />
          </label>
          <label className="form-field">
            <span>轨迹产生米数(/cm)</span>
            <input type="number" step="0.01" min="0" value={trackMeters} onChange={(event) => setTrackMeters(event.target.value)} />
          </label>
          <label className="form-field">
            <span>轨迹存在时间(/s)</span>
            <input type="number" step="1" min="1" value={trackExistsTime} onChange={(event) => setTrackExistsTime(event.target.value)} />
          </label>
          <label className="form-field">
            <span>无人时间(/s)</span>
            <input type="number" step="1" min="1" value={unmannedTime} onChange={(event) => setUnmannedTime(event.target.value)} />
          </label>
          <label className="form-field">
            <span>连续确认帧数</span>
            <input
              type="number"
              step="1"
              min="2"
              max="7"
              value={checkToActiveFrames}
              onChange={(event) => setCheckToActiveFrames(event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="config-section">
        <div className="section-title">
          <h2>安装信息设置</h2>
        </div>
        <div className="form-grid">
          <label className="form-field">
            <span>安装模式</span>
            <select value={mountMode} onChange={(event) => setMountMode(event.target.value)}>
              <option value="侧装">侧装</option>
              <option value="顶装">顶装</option>
            </select>
          </label>
          <label className="form-field">
            <span>高度(cm)</span>
            <input min="0" step="1" type="number" value={mountHeightCm} onChange={(event) => setMountHeightCm(event.target.value)} />
          </label>
          <label className="form-field">
            <span>角度</span>
            <input min="-180" max="180" step="1" type="number" value={mountAngleDeg} onChange={(event) => setMountAngleDeg(event.target.value)} />
          </label>
        </div>
      </div>

      <div className="config-section">
        <div className="section-title">
          <h2>轨迹 / 目标跟踪</h2>
        </div>
        <div className="feature-list">
          <div className="feature-row">
            <div>
              <strong>轨迹 LED</strong>
            </div>
            <button
              type="button"
              className={trackLedEnabled ? "switch switch-on" : "switch"}
              onClick={() => setTrackLedEnabled((prev) => !prev)}
              aria-pressed={trackLedEnabled}
            >
              <span />
            </button>
          </div>
          <div className="feature-row">
            <div>
              <strong>运动 LED</strong>
            </div>
            <button
              type="button"
              className={motionLedEnabled ? "switch switch-on" : "switch"}
              onClick={() => setMotionLedEnabled((prev) => !prev)}
              aria-pressed={motionLedEnabled}
            >
              <span />
            </button>
          </div>
        </div>
        <div className="detail-button-row">
          <button type="button" className="mini-button">重置按钮</button>
          <button type="button" className="mini-button">恢复出厂按钮</button>
        </div>
      </div>
    </div>
  );

  const renderDetailConfigWorkspace = () => {
    const panelExpanded = detailConfigView !== "none";

    const detailConfigLabels: Record<Exclude<DetailConfigView, "none">, { title: string }> = {
      range: {
        title: "探测范围配置",
      },
      tags: {
        title: "标签配置",
      },
      params: {
        title: "设备参数配置",
      },
      mcu: {
        title: "MCU配置",
      },
    };

    const currentView = detailConfigView === "none" ? "range" : detailConfigView;
    const current = detailConfigLabels[currentView];

    return (
      <aside className={panelExpanded ? "display-panel detail-extension-panel" : "display-panel detail-extension-panel detail-extension-panel-collapsed"}>
        <div className="detail-extension-panel-header">
          <div>
            <h2>扩展配置</h2>
            <span>{panelExpanded ? current.title : "轨迹、标签、参数、MCU"}</span>
          </div>
          <button
            type="button"
            className="mini-button"
            onClick={() => setDetailConfigView(panelExpanded ? "none" : "range")}
          >
            {panelExpanded ? "收起" : "展开"}
          </button>
        </div>

        {panelExpanded ? (
          <>
            <div className="detail-extension-tabs" aria-label="扩展配置导航">
              <button
                type="button"
                className={currentView === "range" ? "detail-extension-tab detail-extension-tab-active" : "detail-extension-tab"}
                onClick={() => setDetailConfigView("range")}
              >
                探测范围配置
              </button>
              <button
                type="button"
                className={currentView === "tags" ? "detail-extension-tab detail-extension-tab-active" : "detail-extension-tab"}
                onClick={() => setDetailConfigView("tags")}
              >
                标签配置
              </button>
              <button
                type="button"
                className={currentView === "params" ? "detail-extension-tab detail-extension-tab-active" : "detail-extension-tab"}
                onClick={() => setDetailConfigView("params")}
              >
                设备参数配置
              </button>
              <button
                type="button"
                className={currentView === "mcu" ? "detail-extension-tab detail-extension-tab-active" : "detail-extension-tab"}
                onClick={() => setDetailConfigView("mcu")}
              >
                MCU配置
              </button>
            </div>
            <div className="detail-extension-panel-body">
              {currentView === "range" ? renderRangeConfigSection(false) : null}
              {currentView === "tags" ? renderDetailTagConfigPanel(false) : null}
              {currentView === "params" ? renderDetailParameterConfigPanel() : null}
              {currentView === "mcu" ? renderDetailMcuConfigPanel() : null}
            </div>
          </>
        ) : (
          <div className="detail-extension-collapsed-actions">
            <button type="button" className="detail-extension-entry" onClick={() => openDetailConfigView("range")}>
              探测范围配置
            </button>
            <button type="button" className="detail-extension-entry" onClick={() => openDetailConfigView("tags")}>
              标签配置
            </button>
            <button type="button" className="detail-extension-entry" onClick={() => openDetailConfigView("params")}>
              设备参数配置
            </button>
            <button type="button" className="detail-extension-entry" onClick={() => openDetailConfigView("mcu")}>
              MCU配置
            </button>
          </div>
        )}
      </aside>
    );
  };

  const renderManagement = () => (
    <section className="page-panel">
      <header className="page-header">
        <div>
          <p className="eyebrow">Device Management</p>
          <h1>设备管理</h1>
        </div>
        <span className={`scan-badge scan-badge-${scanState}`}>{statusText[scanState]}</span>
      </header>

      <section className="guide-panel" aria-label="使用教程和注意事项">
        <div>
          <h2>使用教程</h2>
          <div className="guide-list">
            <div className="guide-item">
              <strong>1. 扫描设备</strong>
              <span>点击“扫描设备”刷新列表，扫描到的设备会显示在下方。</span>
            </div>
            <div className="guide-item">
              <strong>2. 首次使用先初始化</strong>
              <span>未初始化的设备不能直接进入详情页，会先跳转到初始化绑定流程。</span>
            </div>
            <div className="guide-item">
              <strong>3. 初始化完成后查看详情</strong>
              <span>完成绑定、基础配置、探测范围和标签配置后，即可进入设备详情展示界面。</span>
            </div>
          </div>
        </div>
        <div className="guide-note">
          <h2>注意事项</h2>
          <p>设备列表只显示真实扫描或后端已保存的 C4004 设备。若列表为空，请确认后端服务、Home Assistant 授权和实体接入状态。</p>
        </div>
      </section>

      <section className="summary-grid" aria-label="设备概览">
        <div className="summary-card">
          <span>扫描结果</span>
          <strong>{devices.length}</strong>
        </div>
        <div className="summary-card">
          <span>当前选择</span>
          <strong>{selectedDevice?.name ?? "未选择"}</strong>
        </div>
      </section>

      <section className="device-section">
        <div className="section-title">
          <div className="scan-heading">
            <button
              type="button"
              className="section-title-button"
              onClick={scanDevices}
              disabled={scanState === "scanning"}
            >
              {scanState === "scanning" ? "扫描中..." : "扫描设备"}
            </button>
            <div className="bound-device-summary" aria-label="已绑定设备">
              <div>
                <strong>已绑定设备</strong>
                <span>{boundDevices.length ? `${boundDevices.length} 台` : "暂无"}</span>
              </div>
              <div className="bound-device-list">
                {boundDevices.length ? (
                  boundDevices.map((device) => (
                    <span className="bound-device-pill" key={device.id}>
                      {device.name}
                      <em className={device.status === "online" ? "online-status online-status-on" : "online-status"}>
                        {device.status === "online" ? "在线" : "离线"}
                      </em>
                    </span>
                  ))
                ) : (
                  <span className="bound-device-empty">完成绑定的设备会显示在这里</span>
                )}
              </div>
            </div>
          </div>
          <span>{devices.length ? `${devices.length} 个可用设备` : "暂无设备"}</span>
        </div>

        {devices.length ? (
          <div className="device-list">
            {devices.map((device) => (
              <div
                className={device.id === selectedDeviceId ? "device-row device-row-selected" : "device-row"}
                key={device.id}
                onClick={() => setSelectedDeviceId(device.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedDeviceId(device.id);
                  }
                }}
                aria-pressed={device.id === selectedDeviceId}
                role="button"
                tabIndex={0}
              >
                <span className="device-radio" aria-hidden="true" />
                <span className="device-main">
                  <strong>{device.name}</strong>
                  <small>
                    {device.manufacturer ? `${device.manufacturer} ` : ""}
                    {device.model} / Prefix: {device.prefix} / MAC: {device.macAddress}
                    {device.haDeviceId ? ` / HA ID: ${device.haDeviceId.slice(0, 8)}` : ""}
                  </small>
                </span>
                <span className="device-meta">
                  <span>{device.entityCount} entities</span>
                  {device.firmwareVersion ? <span>FW {device.firmwareVersion}</span> : null}
                  <em className={device.bound ? "bind-status bind-status-on" : "bind-status"}>
                    {device.bound ? "已绑定" : "未绑定"}
                  </em>
                  <em className={device.status === "online" ? "online-status online-status-on" : "online-status"}>
                    {device.status === "online" ? "在线" : "离线"}
                  </em>
                </span>
                <span className="device-actions">
                  <button
                    type="button"
                    className="device-action-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      enterDeviceConfig(device);
                    }}
                  >
                    初始化流程
                  </button>
                  <button
                    type="button"
                    className="device-action-button"
                    disabled={!device.bound}
                    onClick={(event) => {
                      event.stopPropagation();
                      deployBoundDevice(device);
                    }}
                  >
                    部署设备
                  </button>
                  <button
                    type="button"
                    className="device-action-button device-action-primary"
                    onClick={(event) => {
                      event.stopPropagation();
                      enterDeviceDetail(device);
                    }}
                  >
                    查看设备详情
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>暂无扫描结果</strong>
            <span>点击“扫描设备”后，扫描到的 C4004 设备会显示在这里。</span>
          </div>
        )}
      </section>
    </section>
  );

  const renderConfigStep = () => {
    if (activeStep === "bind") {
      return (
        <section className="config-workspace">
          <div className="config-section bind-section">
            <div className="section-title">
              <h2>绑定设备</h2>
              <span>确认设备信息并完成首次绑定。</span>
            </div>
            <div className="bind-form-grid">
              <label className="form-field form-field-readonly">
                <span>名字</span>
                <input value={selectedDevice?.name ?? ""} readOnly />
              </label>
              <label className="form-field form-field-readonly">
                <span>MAC 地址</span>
                <input value={selectedDevice?.macAddress ?? ""} readOnly />
              </label>
            </div>
            {renderStepNavigation(
              <button
                type="button"
                className="action-button action-primary"
                disabled={!selectedDevice || selectedDevice.bound}
                onClick={() => {
                  if (selectedDevice) {
                    bindDevice(selectedDevice);
                  }
                }}
              >
                {selectedDevice?.bound ? "已绑定" : "绑定设备"}
              </button>,
            )}
          </div>
        </section>
      );
    }

    if (activeStep === "basic") {
      return (
        <section className="config-workspace">
          <div className="config-section">
            <div className="section-title">
              <h2>基础信息配置</h2>
              <span>安装模式只读展示，高度可调，角度跟随安装参数显示。</span>
            </div>
            <div className="form-grid">
              <label className="form-field form-field-readonly">
                <span>安装模式</span>
                <input value={mountMode} readOnly />
              </label>
              <label className="form-field form-field-readonly">
                <span>高度(cm)</span>
                <input value={mountHeightCm} readOnly />
              </label>
              <label className="form-field form-field-readonly">
                <span>角度</span>
                <input value={`${mountAngleDeg}deg`} readOnly />
              </label>
            </div>
          </div>

          <div className="config-section config-note">
            <strong>进入设备详情显示界面</strong>
            <span>基础信息完成后继续配置功能、探测范围和标签，最后跳转到设备实时显示。</span>
          </div>
          {renderStepNavigation()}
        </section>
      );
    }

    if (activeStep === "feature") {
      return (
        <section className="config-workspace">
          <div className="config-section">
            <div className="section-title">
              <h2>功能使能配置</h2>
              <span>人数统计参数只读展示，LED 开关可单独配置。</span>
            </div>
            <div className="metric-grid">
              <div className="metric-card metric-card-readonly">
                <span>Real-time People Time</span>
                <strong>{realTimePeopleTime} s</strong>
              </div>
              <div className="metric-card metric-card-readonly">
                <span>Track Meters</span>
                <strong>{trackMeters} cm</strong>
              </div>
              <div className="metric-card metric-card-readonly">
                <span>Track Exists Time</span>
                <strong>{trackExistsTime} s</strong>
              </div>
              <div className="metric-card metric-card-readonly">
                <span>Unmanned Time</span>
                <strong>{unmannedTime} s</strong>
              </div>
            </div>
          </div>

          <div className="feature-list">
            <div className="feature-row">
              <div>
                <strong>内部默认开启轨迹跟踪功能</strong>
                <span>初始化流程里不单独配置，主配置完成后默认开启。</span>
              </div>
              <span className="state-chip state-chip-on">默认开启</span>
            </div>
            <div className="feature-row">
              <div>
                <strong>轨迹 LED 使能开关</strong>
                <span>用于控制轨迹状态的 LED 显示。</span>
              </div>
              <button
                type="button"
                className={trackLedEnabled ? "switch switch-on" : "switch"}
                onClick={() => setTrackLedEnabled((prev) => !prev)}
                aria-pressed={trackLedEnabled}
              >
                <span />
              </button>
            </div>
            <div className="feature-row">
              <div>
                <strong>运动 LED 使能开关</strong>
                <span>用于控制运动状态的 LED 显示。</span>
              </div>
              <button
                type="button"
                className={motionLedEnabled ? "switch switch-on" : "switch"}
                onClick={() => setMotionLedEnabled((prev) => !prev)}
                aria-pressed={motionLedEnabled}
              >
                <span />
              </button>
            </div>
          </div>
          {renderStepNavigation()}
        </section>
      );
    }

    if (activeStep === "range") {
      return (
        <section className="config-workspace range-workspace">
          {renderRangeConfigSection(true)}
          {renderStepNavigation()}
        </section>
      );
    }

    if (activeStep === "tags") {
      return (
        <section className="config-workspace">
          {renderDetailTagConfigPanel(true)}
          {renderStepNavigation()}
        </section>
      );
    }

    return (
      <section className="config-workspace">
        <div className="complete-panel">
          <span className="state-chip state-chip-on">配置完成</span>
          <h2>跳转到设备详情显示界面</h2>
          <p>初始化绑定和配置流程已经完成，现在可以查看实时人数、轨迹、区域状态和标签信息。</p>
          {renderStepNavigation(
            undefined,
            <button type="button" className="action-button action-primary" onClick={completeInitialization}>
              查看设备详情显示
            </button>,
          )}
        </div>
      </section>
    );
  };

  const renderConfigFlow = () => (
    <section className="configuration-panel">
      <div className="section-title">
        <h2>设备配置使用流程</h2>
        <span>进入设备初始化绑定流程后，按顺序完成各项配置。</span>
      </div>
      <div className="step-tabs" aria-label="设备配置流程">
        {configSteps.map((step, index) => (
          <button
            type="button"
            className={[
              "step-tab",
              index < activeStepIndex ? "step-tab-completed" : "",
              activeStep === step.id ? "step-tab-active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            disabled
            key={step.id}
            aria-current={activeStep === step.id ? "step" : undefined}
          >
            <span>{index + 1}</span>
            <strong>{step.title}</strong>
            <small>{step.subtitle}</small>
          </button>
        ))}
      </div>
      {renderConfigStep()}
    </section>
  );

  const renderTrackingWorkspace = () => {
    const occupiedCount = trackingZones.filter((zone) => zone.occupied).length;
    const activeTargets = trackingTargets.filter((target) => target.active);
    const trackingGridLines: ReactNode[] = [];
    const trackingGridLabels: ReactNode[] = [];

    for (let mm = trackingXMinMm; mm <= trackingXMaxMm; mm += trackingGridMm) {
      const posX = toTrackingCanvasX(mm);
      const isAxis = mm === 0;
      trackingGridLines.push(
        <line
          className={isAxis ? "tracking-grid-axis" : "tracking-grid-line"}
          key={`v-${mm}`}
          x1={posX}
          x2={posX}
          y1={0}
          y2={trackingCanvasHeight}
          vectorEffect="non-scaling-stroke"
        />,
      );
      if (mm === trackingXMinMm || mm === trackingXMaxMm || mm % 2000 === 0) {
        trackingGridLabels.push(
          <text className="tracking-grid-label" key={`x-label-${mm}`} x={posX} y={toTrackingCanvasY(0) + 24}>
            {mm / 1000}m
          </text>,
        );
      }
    }

    for (let mm = trackingYMinMm; mm <= trackingYMaxMm; mm += trackingGridMm) {
      const posY = toTrackingCanvasY(mm);
      const isAxis = mm === 0;
      trackingGridLines.push(
        <line
          className={isAxis ? "tracking-grid-axis" : "tracking-grid-line"}
          key={`h-${mm}`}
          x1={0}
          x2={trackingCanvasWidth}
          y1={posY}
          y2={posY}
          vectorEffect="non-scaling-stroke"
        />,
      );
      if (mm === trackingYMinMm || mm === trackingYMaxMm || mm % 2000 === 0) {
        trackingGridLabels.push(
          <text className="tracking-grid-label tracking-grid-label-y" key={`y-label-${mm}`} x={-10} y={posY + 5}>
            {mm / 1000}m
          </text>,
        );
      }
    }

    const indexedTargetPoints = activeTargets.flatMap((target) => {
      if (target.x === null || target.y === null) {
        return [];
      }

      const point = toTrackingCanvasCoord({ x: target.x * 1000, y: target.y * 1000 });
      return [{ index: target.index, x: point.x, y: point.y, kinesia: target.kinesia ?? 0 }];
    });

    const rectRangeLeft = Math.min(rangeConfig.xMin, rangeConfig.xMax) * 10;
    const rectRangeRight = Math.max(rangeConfig.xMin, rangeConfig.xMax) * 10;
    const rectRangeBottom = Math.min(rangeConfig.yMin, rangeConfig.yMax) * 10;
    const rectRangeTop = Math.max(rangeConfig.yMin, rangeConfig.yMax) * 10;
    const rangeTopLeft = toTrackingCanvasCoord({ x: rectRangeLeft, y: rectRangeTop });
    const rangeBottomRight = toTrackingCanvasCoord({ x: rectRangeRight, y: rectRangeBottom });
    const trackedTags = tagRegions.slice(0, 5);
    const isDetailCustomRangeInteractive = detailConfigView === "range" && rangeMode === "custom" && !customRangeConfirmed;
    const detailLearnedRangeChartPoints = learnedRangePoints.map((point) =>
      toTrackingCanvasCoord({ x: point.x * 1000, y: point.y * 1000 }),
    );
    const detailCustomRangeChartPoints = customRangePoints.map((point) =>
      toTrackingCanvasCoord({ x: point.x * 1000, y: point.y * 1000 }),
    );
    const detailCustomRangePreviewChartPoints =
      customRangePreviewPoint && customRangePoints.length
        ? [customRangePoints[customRangePoints.length - 1], customRangePreviewPoint].map((point) =>
            toTrackingCanvasCoord({ x: point.x * 1000, y: point.y * 1000 }),
          )
        : [];
    const detailLiveCustomRangeChartPoints =
      !customRangeConfirmed && customRangePreviewPoint && customRangePoints.length >= 2
        ? [...customRangePoints, customRangePreviewPoint].map((point) =>
            toTrackingCanvasCoord({ x: point.x * 1000, y: point.y * 1000 }),
          )
        : !customRangeConfirmed && customRangePoints.length >= 3
          ? detailCustomRangeChartPoints
          : [];

    return (
      <section className="display-panel detail-dashboard" id="device-display">
        <div className="detail-layout">
          <aside className="detail-stack detail-stack-left">
            <section className="tracking-card detail-card">
              <div className="tracking-panel-heading">
                <h2>人数显示</h2>
                <span className="tracking-chip">{activeTargets.length} 人</span>
              </div>
              <div className="detail-metric-grid">
                <div>
                  <span>实时人数显示</span>
                  <strong>{activeTargets.length}</strong>
                </div>
                <div>
                  <span>运动目标</span>
                  <strong>{indexedTargetPoints.length}</strong>
                </div>
              </div>
              <button type="button" className="mini-button">
                清除人数
              </button>
            </section>

            <section className="tracking-card detail-card">
              <div className="tracking-panel-heading">
                <h2>基础信息显示</h2>
                <span className="tracking-chip">{selectedDevice?.status === "online" ? "在线" : "离线"}</span>
              </div>
              <div className="tracking-summary">
                <div>
                  <span>存在信息</span>
                  <strong>有人</strong>
                </div>
                <div>
                  <span>运动信息</span>
                  <strong>运动中</strong>
                </div>
                <div>
                  <span>设备状态</span>
                  <strong>设备在线</strong>
                </div>
              </div>
            </section>

            <section className="tracking-card detail-card">
              <div className="tracking-panel-heading">
                <h2>区域实时状态</h2>
                <span className="tracking-chip">{occupiedCount}/6</span>
              </div>
              <div className="zone-status-grid">
                {trackingZones.map((zone) => (
                  <div className={zone.occupied ? "zone-status occupied" : "zone-status"} key={zone.id}>
                    <span>{zone.name}</span>
                    <strong>{zone.occupied ? "有人" : "无人"}</strong>
                  </div>
                ))}
              </div>
            </section>
          </aside>

          <section className="tracking-map-panel detail-map-panel">
            <div className="coordinate-canvas detail-coordinate-canvas">
              <svg
                ref={trackingChartRef}
                className={isDetailCustomRangeInteractive ? "detail-coordinate-svg detail-coordinate-svg-sketch-enabled" : "detail-coordinate-svg"}
                viewBox={`${-trackingCanvasPadding} ${-trackingCanvasPadding} ${
                  trackingCanvasWidth + trackingCanvasPadding * 2
                } ${trackingCanvasHeight + trackingCanvasPadding * 2}`}
                preserveAspectRatio="xMidYMid meet"
                onPointerDown={handleDetailCustomRangeCanvasClick}
                onPointerMove={previewDetailCustomRangeLine}
                onPointerLeave={stopCustomRangePreview}
                onMouseLeave={stopCustomRangePreview}
                role="img"
                aria-label="C4004 tracking coordinate preview"
              >
                <rect
                  x={-trackingCanvasPadding}
                  y={-trackingCanvasPadding}
                  width={trackingCanvasWidth + trackingCanvasPadding * 2}
                  height={trackingCanvasHeight + trackingCanvasPadding * 2}
                  fill="#f8fafc"
                />
                <rect
                  className="tracking-canvas-event-layer"
                  x={-trackingCanvasPadding}
                  y={-trackingCanvasPadding}
                  width={trackingCanvasWidth + trackingCanvasPadding * 2}
                  height={trackingCanvasHeight + trackingCanvasPadding * 2}
                />
                {trackingGridLines}
                {trackingGridLabels}
                {rangeMode === "rect" ? (
                  <rect
                    className="tracking-range-frame"
                    x={rangeTopLeft.x}
                    y={rangeTopLeft.y}
                    width={rangeBottomRight.x - rangeTopLeft.x}
                    height={rangeBottomRight.y - rangeTopLeft.y}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {rangeMode === "learned" && learnedRangeModeEnabled && detailLearnedRangeChartPoints.length >= 3 ? (
                  <polygon
                    className="range-learned-polygon"
                    points={formatRangeSketchPoints(detailLearnedRangeChartPoints)}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {rangeMode === "learned" && learnedRangeModeEnabled
                  ? detailLearnedRangeChartPoints.map((point, index) => (
                      <g className="range-learned-vertex" key={`detail-learned-${point.x}-${point.y}-${index}`}>
                        <circle cx={point.x} cy={point.y} r="12" vectorEffect="non-scaling-stroke" />
                      </g>
                    ))
                  : null}
                {rangeMode === "custom" && detailLiveCustomRangeChartPoints.length >= 3 ? (
                  <polygon
                    className="range-custom-polygon-preview"
                    points={formatRangeSketchPoints(detailLiveCustomRangeChartPoints)}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {rangeMode === "custom" && customRangeConfirmed && detailCustomRangeChartPoints.length >= 3 ? (
                  <polygon
                    className="range-custom-polygon"
                    points={formatRangeSketchPoints(detailCustomRangeChartPoints)}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {rangeMode === "custom" && detailCustomRangeChartPoints.length > 1 ? (
                  <polyline
                    className="range-custom-line"
                    points={formatRangeSketchPoints(detailCustomRangeChartPoints)}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {rangeMode === "custom" && detailCustomRangePreviewChartPoints.length > 1 ? (
                  <polyline
                    className="range-custom-line range-custom-line-draft"
                    points={formatRangeSketchPoints(detailCustomRangePreviewChartPoints)}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {rangeMode === "custom"
                  ? detailCustomRangeChartPoints.map((point, index) => (
                      <g className="range-custom-vertex" key={`detail-custom-${point.x}-${point.y}-${index}`}>
                        <circle cx={point.x} cy={point.y} r="14" vectorEffect="non-scaling-stroke" />
                        <text x={point.x} y={point.y + 5}>
                          {index + 1}
                        </text>
                      </g>
                    ))
                  : null}
                <text x={trackingCanvasWidth - 24} y={toTrackingCanvasY(0) - 14} className="tracking-axis-label">
                  X
                </text>
                <text x={toTrackingCanvasX(0) + 12} y={26} className="tracking-axis-label">
                  Y
                </text>

                {trackedTags.map((region) => {
                  const centerM = { x: (region.xMin + region.xMax) / 2, y: (region.yMin + region.yMax) / 2 };
                  const center = toTrackingCanvasCoord({ x: centerM.x * 1000, y: centerM.y * 1000 });
                  const radius = Math.abs(toTrackingCanvasX(centerM.x * 1000 + region.xSizeCm * 10) - center.x);
                  const topLeft = toTrackingCanvasCoord({ x: region.xMin * 1000, y: region.yMax * 1000 });
                  const bottomRight = toTrackingCanvasCoord({ x: region.xMax * 1000, y: region.yMin * 1000 });
                  const tagLabel = tagTypeOptions.find((option) => option.value === region.tagType)?.label ?? "无";

                  return (
                    <g className="detail-tag-shape" key={region.id}>
                      {region.rangeShape === "circle" ? (
                        <circle cx={center.x} cy={center.y} r={radius} vectorEffect="non-scaling-stroke" />
                      ) : (
                        <rect
                          x={topLeft.x}
                          y={topLeft.y}
                          width={bottomRight.x - topLeft.x}
                          height={bottomRight.y - topLeft.y}
                          vectorEffect="non-scaling-stroke"
                        />
                      )}
                      <text x={center.x} y={center.y - 4}>
                        <tspan x={center.x}>{region.name}</tspan>
                        <tspan x={center.x} dy="18">
                          IDX {region.index} {tagLabel}
                        </tspan>
                      </text>
                    </g>
                  );
                })}

                {indexedTargetPoints.map((target) => (
                  <g className="indexed-target" key={target.index}>
                    <circle cx={target.x} cy={target.y} r="14" vectorEffect="non-scaling-stroke" />
                    <text x={target.x} y={target.y + 5}>
                      {target.index}
                    </text>
                    <text className="target-kinesia-label" x={target.x + 18} y={target.y - 14}>
                      {target.kinesia}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </section>

          {renderDetailConfigWorkspace()}
        </div>
      </section>
    );
  };

  const renderConfigPage = () => (
    <section className="page-panel page-panel-wide config-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Device Configuration</p>
          <h1>设备初始化绑定流程</h1>
        </div>
        {selectedDevice ? (
          <section className="config-header-device" aria-label="当前初始化设备">
            <div>
              <span>当前设备</span>
              <strong>{selectedDevice.name}</strong>
            </div>
            <div>
              <span>MAC 地址</span>
              <strong>{selectedDevice.macAddress}</strong>
            </div>
            <div>
              <span>HA Device ID</span>
              <strong>{selectedDevice.haDeviceId ? selectedDevice.haDeviceId.slice(0, 12) : "未获取"}</strong>
            </div>
          </section>
        ) : null}
      </header>

      {selectedDevice ? (
        renderConfigFlow()
      ) : (
        <div className="empty-state empty-state-large">
          <strong>未选择设备</strong>
          <span>请先在设备管理中扫描并选择设备。</span>
          <button type="button" className="action-button action-primary" onClick={() => setPage("management")}>
            返回设备管理
          </button>
        </div>
      )}
    </section>
  );

  const renderDeploymentDevice = (device: ManagedDevice, placement: DeploymentPlacement) => {
    const rangeMm = placement.rangeM * 1000;
    const halfFov = placement.fovDeg / 2;
    const startAngle = ((placement.rotationDeg - halfFov) * Math.PI) / 180;
    const endAngle = ((placement.rotationDeg + halfFov) * Math.PI) / 180;
    const start = {
      x: placement.x + Math.cos(startAngle) * rangeMm,
      y: placement.y + Math.sin(startAngle) * rangeMm,
    };
    const end = {
      x: placement.x + Math.cos(endAngle) * rangeMm,
      y: placement.y + Math.sin(endAngle) * rangeMm,
    };
    const largeArc = placement.fovDeg > 180 ? 1 : 0;
    const selected = selectedDeploymentDeviceId === device.id;

    return (
      <g
        className={selected ? "deployment-device deployment-device-selected" : "deployment-device"}
        key={device.id}
        onPointerDown={(event) => startDraggingDeploymentDevice(event, device.id)}
      >
        <path
          className="deployment-fov"
          d={`M ${placement.x} ${placement.y} L ${start.x} ${start.y} A ${rangeMm} ${rangeMm} 0 ${largeArc} 1 ${end.x} ${end.y} Z`}
        />
        {[0.35, 0.62, 0.88].map((scale) => (
          <path
            className="deployment-wifi-arc"
            d={`M ${placement.x + Math.cos(startAngle) * rangeMm * scale} ${
              placement.y + Math.sin(startAngle) * rangeMm * scale
            } A ${rangeMm * scale} ${rangeMm * scale} 0 ${largeArc} 1 ${
              placement.x + Math.cos(endAngle) * rangeMm * scale
            } ${placement.y + Math.sin(endAngle) * rangeMm * scale}`}
            key={scale}
          />
        ))}
        <circle className="deployment-device-dot" cx={placement.x} cy={placement.y} r={180} />
        <line
          className="deployment-device-heading"
          x1={placement.x}
          y1={placement.y}
          x2={placement.x + Math.cos((placement.rotationDeg * Math.PI) / 180) * 520}
          y2={placement.y + Math.sin((placement.rotationDeg * Math.PI) / 180) * 520}
        />
        <text className="deployment-device-label" x={placement.x + 260} y={placement.y - 230}>
          {device.name}
        </text>
      </g>
    );
  };

  const renderDeployment = () => (
    <section className="deployment-page">
      <div className="deployment-toolbar">
        <div>
          <p className="eyebrow">Device Deployment</p>
          <h1>设备部署</h1>
          <span>绘制墙体边界，将已绑定设备拖拽到部署位置，并调整探测方向与角度。</span>
        </div>
        <div className="deployment-toolbar-actions">
          <button
            type="button"
            className={isDrawingDeploymentWall ? "action-button action-primary" : "action-button"}
            onClick={() => {
              setIsDrawingDeploymentWall((prev) => !prev);
              setDeploymentWallStart(null);
              setDeploymentWallPreview(null);
            }}
          >
            {isDrawingDeploymentWall ? "结束绘墙" : "绘制墙体"}
          </button>
          <button type="button" className="action-button" onClick={removeDeploymentWall} disabled={!deploymentWalls.length}>
            撤销墙线
          </button>
          <button type="button" className="action-button" onClick={clearDeployment}>
            清空部署
          </button>
        </div>
      </div>

      <div className="deployment-workspace">
        <svg
          ref={deploymentCanvasRef}
          className={[
            "deployment-canvas",
            isDrawingDeploymentWall ? "deployment-canvas-drawing" : "",
            deploymentPanDrag ? "deployment-canvas-panning" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          viewBox={`${deploymentViewBox.x} ${deploymentViewBox.y} ${deploymentViewBox.width} ${deploymentViewBox.height}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={handleDeploymentCanvasPointerDown}
          onPointerMove={handleDeploymentPointerMove}
          onPointerUp={stopDeploymentInteractions}
          onPointerLeave={stopDeploymentInteractions}
          onWheel={handleDeploymentWheel}
          role="img"
          aria-label="设备部署坐标系"
        >
          <rect
            className="deployment-background"
            x={deploymentGridLines.xMin}
            y={deploymentGridLines.yMin}
            width={deploymentGridLines.xMax - deploymentGridLines.xMin}
            height={deploymentGridLines.yMax - deploymentGridLines.yMin}
          />
          {deploymentGridLines.vertical.map((x) => (
            <line
              className={x === 0 ? "deployment-axis" : "deployment-grid-line"}
              key={`x-${x}`}
              x1={x}
              x2={x}
              y1={deploymentGridLines.yMin}
              y2={deploymentGridLines.yMax}
            />
          ))}
          {deploymentGridLines.horizontal.map((y) => (
            <line
              className={y === 0 ? "deployment-axis" : "deployment-grid-line"}
              key={`y-${y}`}
              x1={deploymentGridLines.xMin}
              x2={deploymentGridLines.xMax}
              y1={y}
              y2={y}
            />
          ))}
          {deploymentGridLines.vertical
            .filter((x) => x % 2000 === 0)
            .map((x) => (
              <text className="deployment-axis-label" key={`xl-${x}`} x={x + 80} y={120}>
                {formatDeploymentMeters(x)}
              </text>
            ))}
          {deploymentGridLines.horizontal
            .filter((y) => y % 2000 === 0 && y !== 0)
            .map((y) => (
              <text className="deployment-axis-label" key={`yl-${y}`} x={120} y={y - 80}>
                {formatDeploymentMeters(y)}
              </text>
            ))}
          {deploymentWalls.map((wall) => (
            <line
              className="deployment-wall"
              key={wall.id}
              x1={wall.start.x}
              y1={wall.start.y}
              x2={wall.end.x}
              y2={wall.end.y}
            />
          ))}
          {deploymentWallStart && deploymentWallPreview ? (
            <line
              className="deployment-wall-preview"
              x1={deploymentWallStart.x}
              y1={deploymentWallStart.y}
              x2={deploymentWallPreview.x}
              y2={deploymentWallPreview.y}
            />
          ) : null}
          {deployedDevices.map((device) => renderDeploymentDevice(device, deploymentPlacements[device.id]))}
        </svg>

        <aside className="deployment-panel">
          <section className="deployment-card">
            <strong>坐标系</strong>
            <div className="deployment-zoom-buttons">
              <button type="button" onClick={() => updateDeploymentZoom(deploymentZoom + 0.1)}>
                Zoom +
              </button>
              <button type="button" onClick={() => updateDeploymentZoom(deploymentZoom - 0.1)}>
                Zoom -
              </button>
              <button type="button" onClick={resetDeploymentView}>
                Reset
              </button>
            </div>
            <label className="deployment-control">
              <span>缩放 {deploymentZoom.toFixed(2)}x</span>
              <input
                type="range"
                min="0.1"
                max="5"
                step="0.05"
                value={deploymentZoom}
                onChange={(event) => updateDeploymentZoom(Number(event.target.value))}
              />
            </label>
            <small>滚轮或按钮缩放，拖动画布平移；绘墙时点击两点生成墙线并按 {deploymentSnapMm}mm 网格吸附。</small>
          </section>

          <section className="deployment-card">
            <strong>可部署设备</strong>
            <div className="deployment-device-list">
              {boundDevices.length ? (
                boundDevices.map((device) => (
                  <button
                    type="button"
                    className={
                      deploymentPlacements[device.id]
                        ? "deployment-device-button deployment-device-button-active"
                        : "deployment-device-button"
                    }
                    key={device.id}
                    onClick={() => deployBoundDevice(device)}
                  >
                    <span>{device.name}</span>
                    <small>{device.macAddress}</small>
                  </button>
                ))
              ) : (
                <small>请先在设备管理中完成设备绑定。</small>
              )}
            </div>
          </section>

          <section className="deployment-card">
            <strong>探测角度</strong>
            {selectedDeploymentDevice && selectedDeploymentPlacement ? (
              <div className="deployment-controls">
                <span>{selectedDeploymentDevice.name}</span>
                <label className="deployment-control">
                  <span>方向 {Math.round(selectedDeploymentPlacement.rotationDeg)}deg</span>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    step="1"
                    value={selectedDeploymentPlacement.rotationDeg}
                    onChange={(event) =>
                      updateDeploymentPlacement(selectedDeploymentDevice.id, { rotationDeg: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="deployment-control">
                  <span>探测角 {Math.round(selectedDeploymentPlacement.fovDeg)}deg</span>
                  <input
                    type="range"
                    min="30"
                    max="160"
                    step="1"
                    value={selectedDeploymentPlacement.fovDeg}
                    onChange={(event) =>
                      updateDeploymentPlacement(selectedDeploymentDevice.id, { fovDeg: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="deployment-control">
                  <span>探测距离 {selectedDeploymentPlacement.rangeM.toFixed(1)}m</span>
                  <input
                    type="range"
                    min="1"
                    max="9"
                    step="0.5"
                    value={selectedDeploymentPlacement.rangeM}
                    onChange={(event) =>
                      updateDeploymentPlacement(selectedDeploymentDevice.id, { rangeM: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
            ) : (
              <small>选择或部署一个设备后可调整 Wi-Fi 探测图案。</small>
            )}
          </section>
        </aside>
      </div>
    </section>
  );

  const renderDetail = () => (
    <section className="page-panel page-panel-wide">
      <header className="page-header">
        <div>
          <p className="eyebrow">Device Detail</p>
          <h1>设备详情展示</h1>
          {selectedDevice ? (
            <p className="detail-header-meta">
              {selectedDevice.name} / {selectedDevice.model} / Prefix: {selectedDevice.prefix} / MAC:{" "}
              {selectedDevice.macAddress}
            </p>
          ) : null}
        </div>
        {selectedDevice ? (
          <span className="scan-badge scan-badge-done">{selectedDevice.bound ? "已绑定" : "待绑定"}</span>
        ) : null}
      </header>

      {selectedDevice ? (
        renderTrackingWorkspace()
      ) : (
        <div className="empty-state empty-state-large">
          <strong>未选择设备</strong>
          <span>请先在设备管理中扫描并选择设备。</span>
          <button type="button" className="action-button action-primary" onClick={() => setPage("management")}>
            返回设备管理
          </button>
        </div>
      )}
    </section>
  );
  return (
    <main className="app-shell">
      {renderSidebar()}
      <div className="content-area">
        {error ? <div className="notice notice-error">{error}</div> : null}
        {message ? <div className="notice notice-ok">{message}</div> : null}
        {page === "management" ? renderManagement() : null}
        {page === "deployment" ? renderDeployment() : null}
        {page === "config" ? renderConfigPage() : null}
        {page === "detail" ? renderDetail() : null}
      </div>
    </main>
  );
}

export default App;




