export interface AppConfig {
  port: number;
  frontendDist: string;
  dataDir: string;
  defaultEntityPrefix: string;
  debugLogging: boolean;
  haBaseUrl: string;
  haToken?: string;
  haTokenSource: string;
  haMode: "supervisor" | "standalone";
}

import fs from "node:fs";
import path from "node:path";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

// Persistent storage under HA's config folder (mapped via config:rw in config.yaml).
// /data is container-internal and is not visible from the HA file editor or Samba share.
const DEFAULT_HA_DATA_DIR = "/config/dfrobot-c4004-app";

const readFirstExistingFile = (paths: string[]): string | undefined => {
  for (const filePath of paths) {
    try {
      const value = fs.readFileSync(filePath, "utf8").trim();
      if (value.length > 0) {
        return value;
      }
    } catch {
      // Missing files are expected outside the Home Assistant add-on runtime.
    }
  }
  return undefined;
};

const loadAddonOptions = (): Record<string, unknown> => {
  try {
    const raw = fs.readFileSync("/data/options.json", "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const stringOption = (options: Record<string, unknown>, key: string): string | undefined => {
  const value = options[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
};

const booleanOption = (options: Record<string, unknown>, key: string): boolean | undefined => {
  const value = options[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return undefined;
};

const resolveToken = (options: Record<string, unknown>) => {
  const candidates = [
    { source: "HA_LONG_LIVED_TOKEN env", value: process.env.HA_LONG_LIVED_TOKEN },
    { source: "ha_long_lived_token option", value: stringOption(options, "ha_long_lived_token") },
    { source: "SUPERVISOR_TOKEN env", value: process.env.SUPERVISOR_TOKEN },
    {
      source: "s6 SUPERVISOR_TOKEN file",
      value: readFirstExistingFile([
        "/run/s6/container_environment/SUPERVISOR_TOKEN",
        "/var/run/s6/container_environment/SUPERVISOR_TOKEN",
      ]),
    },
  ];

  return candidates.find((candidate) => candidate.value && candidate.value.length > 0) ?? {
    source: "not configured",
    value: undefined,
  };
};

export const loadConfig = (): AppConfig => {
  const options = loadAddonOptions();
  const token = resolveToken(options);
  const configuredBaseUrl = process.env.HA_BASE_URL ?? stringOption(options, "ha_base_url");
  const defaultDataDir = fs.existsSync("/config")
    ? DEFAULT_HA_DATA_DIR
    : path.resolve(process.cwd(), "data");

  const haMode = configuredBaseUrl ? "standalone" : "supervisor";
  const haBaseUrl = trimTrailingSlash(configuredBaseUrl ?? "http://supervisor/core/api");

  return {
    port: Number(process.env.PORT ?? 42069),
    frontendDist: process.env.FRONTEND_DIST ?? "frontend/dist",
    dataDir: process.env.DATA_DIR ?? stringOption(options, "data_dir") ?? defaultDataDir,
    defaultEntityPrefix: process.env.C4004_ENTITY_PREFIX ?? stringOption(options, "c4004_entity_prefix") ?? "auto",
    debugLogging:
      process.env.C4004_DEBUG_LOGGING === "true" ||
      process.env.C4004_DEBUG_LOGGING === "1" ||
      booleanOption(options, "debug_logging") === true,
    haBaseUrl,
    haToken: token.value,
    haTokenSource: token.source,
    haMode,
  };
};
