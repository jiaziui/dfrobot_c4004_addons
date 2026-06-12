export interface HealthResponse {
  ok: boolean;
  app: string;
  port: number;
  ha: {
    configured: boolean;
    mode: string;
    baseUrl: string;
    tokenSource?: string;
  };
  defaultEntityPrefix: string;
  debugLogging?: boolean;
  dataDir?: string;
}

export interface C4004EntityState {
  key: string;
  label: string;
  domain: string;
  slug: string;
  group: string;
  access: "read" | "write" | "readwrite" | "action";
  valueType?: "boolean" | "number" | "select" | "button";
  options?: string[];
  dangerous?: boolean;
  applyHint?: string;
  entityId: string;
  exists: boolean;
  state: string | null;
  available: boolean;
  attributes: Record<string, unknown> | null;
  lastChanged: string | null;
  lastUpdated: string | null;
}

export interface C4004StateResponse {
  ok: boolean;
  prefix: string;
  entities: C4004EntityState[];
  missing: string[];
  readable: Record<string, string | null>;
  writable: C4004EntityState[];
  error?: string;
}

export interface DiscoveryCandidate {
  prefix: string;
  score: number;
  status?: "online" | "offline";
  deviceId?: string;
  deviceName?: string;
  manufacturer?: string;
  deviceModel?: string;
  firmwareVersion?: string;
  macAddress?: string;
  entities: Array<{
    key: string;
    label: string;
    entityId: string;
    state: string;
  }>;
}

export interface StoredC4004Device {
  id: string;
  haDeviceId?: string;
  name: string;
  model: string;
  manufacturer?: string;
  firmwareVersion?: string;
  prefix: string;
  status: "online" | "offline";
  signal: number;
  entityCount: number;
  macAddress: string;
  bound: boolean;
  initialized: boolean;
  lastSeen: string;
  entities: DiscoveryCandidate["entities"];
  discoveredAt: string;
  lastUpdated: string;
}

export interface DiscoveryResponse {
  ok: boolean;
  candidates: DiscoveryCandidate[];
  devices?: StoredC4004Device[];
  stateCount: number;
  error?: string;
}

export interface SavedDevicesResponse {
  ok: boolean;
  devices: StoredC4004Device[];
  updatedAt: string | null;
  error?: string;
}

export type StoredC4004DevicePatch = Partial<
  Pick<StoredC4004Device, "name" | "status" | "bound" | "initialized">
>;

export interface UpdateDeviceResponse {
  ok: boolean;
  device?: StoredC4004Device;
  error?: string;
}

export interface WriteResponse {
  ok: boolean;
  entityId?: string;
  domain?: string;
  state?: unknown;
  error?: string;
}

export interface DebugLogEntry {
  id: number;
  timestamp: string;
  scope: string;
  message: string;
  data?: unknown;
}

export interface DebugLogsResponse {
  ok: boolean;
  logs: DebugLogEntry[];
}

const ingressAware = (path: string): string => {
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return `/${path.replace(/^\/+/, "")}`;
  }

  const base = window.location.pathname.endsWith("/") ? window.location.pathname : `${window.location.pathname}/`;
  return `${base}${path.replace(/^\/+/, "")}`;
};

const handle = async <T,>(res: Response): Promise<T> => {
  const text = await res.text();
  let data: unknown = null;

  if (text.trim()) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new Error("接口返回格式异常，请确认后端服务已启动");
    }
  }

  if (!res.ok) {
    const message = typeof data === "object" && data !== null && "error" in data ? String(data.error) : res.statusText;
    throw new Error(message);
  }

  if (data === null) {
    throw new Error("接口没有返回数据，请确认后端服务已启动");
  }

  return data as T;
};

export const fetchHealth = async (): Promise<HealthResponse> => {
  return handle<HealthResponse>(await fetch(ingressAware("api/health")));
};

export const fetchC4004State = async (prefix: string): Promise<C4004StateResponse> => {
  const query = new URLSearchParams({ prefix });
  return handle<C4004StateResponse>(await fetch(ingressAware(`api/c4004/state?${query}`)));
};

export const discoverC4004Entities = async (): Promise<DiscoveryResponse> => {
  return handle<DiscoveryResponse>(await fetch(ingressAware("api/c4004/discover")));
};

export const fetchC4004Devices = async (): Promise<SavedDevicesResponse> => {
  return handle<SavedDevicesResponse>(await fetch(ingressAware("api/c4004/devices")));
};

export const updateC4004Device = async (
  deviceId: string,
  patch: StoredC4004DevicePatch,
): Promise<UpdateDeviceResponse> => {
  return handle<UpdateDeviceResponse>(
    await fetch(ingressAware(`api/c4004/devices/${encodeURIComponent(deviceId)}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
};

export const fetchDebugLogs = async (): Promise<DebugLogsResponse> => {
  return handle<DebugLogsResponse>(await fetch(ingressAware("api/debug/logs")));
};

export const writeC4004Entity = async (
  prefix: string,
  key: string,
  value?: string | number | boolean,
): Promise<WriteResponse> => {
  return handle<WriteResponse>(
    await fetch(ingressAware("api/c4004/write"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, key, value }),
    }),
  );
};
