import fs from "node:fs";
import path from "node:path";
import { C4004DiscoveryCandidate } from "./c4004Entities";

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
  entities: C4004DiscoveryCandidate["entities"];
  discoveredAt: string;
  lastUpdated: string;
}

export type StoredC4004DevicePatch = Partial<
  Pick<StoredC4004Device, "name" | "status" | "bound" | "initialized">
>;

interface StoredInventory {
  schemaVersion: 1;
  updatedAt: string;
  devices: StoredC4004Device[];
}

const sanitizeIdPart = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

const toStableDeviceId = (candidate: C4004DiscoveryCandidate) => {
  if (candidate.deviceId) {
    return `c4004-${sanitizeIdPart(candidate.deviceId)}`;
  }
  if (candidate.macAddress) {
    return `c4004-${sanitizeIdPart(candidate.macAddress)}`;
  }

  const prefix = candidate.prefix || "auto";
  const firstEntity = candidate.entities[0]?.entityId ?? "";
  return `c4004-${sanitizeIdPart(prefix) || sanitizeIdPart(firstEntity) || "device"}`;
};

const unknownMacAddress = "未获取";
const generatedPlaceholderMacAddress = /^A4:C1:38:4B:20:[0-9]{2}$/i;

const keepRealOrUnknownMacAddress = (value?: string) => {
  if (!value || generatedPlaceholderMacAddress.test(value)) {
    return unknownMacAddress;
  }

  return value;
};

const normalizeStoredDevice = (device: StoredC4004Device): StoredC4004Device => ({
  ...device,
  status: device.status === "online" ? "online" : "offline",
  macAddress: keepRealOrUnknownMacAddress(device.macAddress),
});

const LEGACY_DATA_FILE = "/data/dfrobot-c4004-app/c4004-devices.json";
const LEGACY_INVENTORY_FILE = "c4004-devices.json";

export class C4004DeviceStorage {
  private readonly devicesDir: string;
  private readonly legacyInventoryFile: string;
  private readonly writeLocks = new Map<string, Promise<void>>();

  constructor(private readonly dataDir: string) {
    this.devicesDir = path.join(dataDir, "devices");
    this.legacyInventoryFile = path.join(dataDir, LEGACY_INVENTORY_FILE);
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getDevicesDir(): string {
    return this.devicesDir;
  }

  listDevices(): StoredC4004Device[] {
    this.migrateLegacyStorageIfNeeded();
    this.ensureDevicesDirectoryExists();

    try {
      const files = fs.readdirSync(this.devicesDir);
      const devices: StoredC4004Device[] = [];

      for (const file of files) {
        if (file.startsWith(".") || !file.endsWith(".json")) {
          continue;
        }

        const deviceId = file.slice(0, -".json".length);
        const device = this.readDevice(deviceId);
        if (device) {
          devices.push(device);
        }
      }

      return devices.sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      return [];
    }
  }

  getUpdatedAt(): string | null {
    const devices = this.listDevices();
    if (!devices.length) {
      return null;
    }

    return devices.reduce((latest, device) => (device.lastUpdated > latest ? device.lastUpdated : latest), devices[0].lastUpdated);
  }

  async replaceFromDiscovery(candidates: C4004DiscoveryCandidate[]): Promise<StoredC4004Device[]> {
    const now = new Date().toISOString();
    const previousDevices = this.listDevices();
    const previousById = new Map(previousDevices.map((device) => [device.id, device]));
    const previousByPrefix = new Map(previousDevices.map((device) => [device.prefix, device]));
    const devices = candidates.map((candidate, index) => {
      const id = toStableDeviceId(candidate);
      const prefix = candidate.prefix || "auto";
      const previous = previousById.get(id) ?? previousByPrefix.get(prefix);

      return normalizeStoredDevice({
        id,
        haDeviceId: candidate.deviceId ?? previous?.haDeviceId,
        name: candidate.deviceName ?? previous?.name ?? `C4004 设备 ${index + 1}`,
        model: candidate.deviceModel ?? previous?.model ?? "DFRobot C4004",
        manufacturer: candidate.manufacturer ?? previous?.manufacturer,
        firmwareVersion: candidate.firmwareVersion ?? previous?.firmwareVersion,
        prefix,
        status: candidate.status ?? "offline",
        signal: Math.min(98, 64 + candidate.score * 4),
        entityCount: candidate.entities.length,
        macAddress: keepRealOrUnknownMacAddress(candidate.macAddress ?? previous?.macAddress),
        bound: previous?.bound ?? false,
        initialized: previous?.initialized ?? false,
        lastSeen: "刚刚",
        entities: candidate.entities,
        discoveredAt: previous?.discoveredAt ?? now,
        lastUpdated: now,
      });
    });

    const activeIds = new Set(devices.map((device) => device.id));
    await Promise.all(devices.map((device) => this.saveDevice(device)));

    for (const file of this.listDeviceFileNames()) {
      const deviceId = file.slice(0, -".json".length);
      if (!activeIds.has(deviceId)) {
        this.deleteDeviceFile(deviceId);
      }
    }

    return devices;
  }

  async updateDevice(deviceId: string, patch: StoredC4004DevicePatch): Promise<StoredC4004Device | null> {
    const current = this.readDevice(deviceId);
    if (!current) {
      return null;
    }

    const nextDevice = normalizeStoredDevice({
      ...current,
      ...patch,
      lastUpdated: new Date().toISOString(),
    });
    await this.saveDevice(nextDevice);
    return nextDevice;
  }

  private ensureDataDirectoryExists(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  private ensureDevicesDirectoryExists(): void {
    this.ensureDataDirectoryExists();
    fs.mkdirSync(this.devicesDir, { recursive: true });
  }

  private getDeviceFilePath(deviceId: string): string {
    return path.join(this.devicesDir, `${deviceId}.json`);
  }

  private listDeviceFileNames(): string[] {
    this.ensureDevicesDirectoryExists();
    try {
      return fs.readdirSync(this.devicesDir).filter((file) => !file.startsWith(".") && file.endsWith(".json"));
    } catch {
      return [];
    }
  }

  private readDevice(deviceId: string): StoredC4004Device | null {
    const filePath = this.getDeviceFilePath(deviceId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (!this.isStoredDevice(parsed) || parsed.id !== deviceId) {
        return null;
      }
      return normalizeStoredDevice(parsed);
    } catch {
      return null;
    }
  }

  private async saveDevice(device: StoredC4004Device): Promise<void> {
    this.ensureDevicesDirectoryExists();

    const pendingLock = this.writeLocks.get(device.id);
    if (pendingLock) {
      await pendingLock;
    }

    let releaseLock: () => void = () => undefined;
    const writeLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.writeLocks.set(device.id, writeLock);

    try {
      const filePath = this.getDeviceFilePath(device.id);
      const tempPath = path.join(this.devicesDir, `.${device.id}.tmp`);
      fs.writeFileSync(tempPath, JSON.stringify(device, null, 2), "utf8");
      fs.renameSync(tempPath, filePath);
    } finally {
      releaseLock();
      this.writeLocks.delete(device.id);
    }
  }

  private deleteDeviceFile(deviceId: string): void {
    const filePath = this.getDeviceFilePath(deviceId);
    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      fs.unlinkSync(filePath);
    } catch {
      // Ignore delete errors for stale device files.
    }
  }

  private migrateLegacyStorageIfNeeded(): void {
    if (this.listDeviceFileNames().length > 0) {
      return;
    }

    const legacySources = [this.legacyInventoryFile, LEGACY_DATA_FILE];
    for (const legacyFile of legacySources) {
      const inventory = this.readLegacyInventory(legacyFile);
      if (!inventory?.devices.length) {
        continue;
      }

      this.ensureDevicesDirectoryExists();
      for (const device of inventory.devices.map(normalizeStoredDevice)) {
        const filePath = this.getDeviceFilePath(device.id);
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, JSON.stringify(device, null, 2), "utf8");
        }
      }

      console.log(
        `[storage] migrated ${inventory.devices.length} device(s) from ${legacyFile} to ${this.devicesDir}`,
      );
      return;
    }
  }

  private readLegacyInventory(filePath: string): StoredInventory | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (!this.isInventory(parsed)) {
        return null;
      }
      return {
        ...parsed,
        devices: parsed.devices.map((device) => normalizeStoredDevice(device)),
      };
    } catch {
      return null;
    }
  }

  private isStoredDevice(value: unknown): value is StoredC4004Device {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const candidate = value as Partial<StoredC4004Device>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.name === "string" &&
      typeof candidate.prefix === "string" &&
      Array.isArray(candidate.entities)
    );
  }

  private isInventory(value: unknown): value is StoredInventory {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const candidate = value as Partial<StoredInventory>;
    return candidate.schemaVersion === 1 && typeof candidate.updatedAt === "string" && Array.isArray(candidate.devices);
  }
}
