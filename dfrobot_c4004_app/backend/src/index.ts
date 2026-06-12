import express from "express";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";
import {
  buildC4004State,
  C4004DiscoveryCandidate,
  discoverC4004Candidates,
  discoverC4004CandidatesFromRegistries,
  enrichC4004CandidatesWithDeviceInfo,
  findWritableEntity,
  toEntityId,
  writeC4004Entity,
} from "./c4004Entities";
import { addDebugLog, getDebugLogs } from "./debugLog";
import { C4004DeviceStorage, StoredC4004DevicePatch } from "./deviceStorage";
import { HomeAssistantClient } from "./haClient";

const config = loadConfig();
const haClient = new HomeAssistantClient(config);
const deviceStorage = new C4004DeviceStorage(config.dataDir);
const app = express();

app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

const getPrefix = (value: unknown): string => {
  if (typeof value === "string" && /^[a-z0-9_]+$/i.test(value)) {
    return value.toLowerCase();
  }
  return config.defaultEntityPrefix;
};

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "dfrobot-c4004-app",
    port: config.port,
    ha: {
      configured: haClient.configured,
      mode: config.haMode,
      baseUrl: config.haBaseUrl,
      tokenSource: config.haTokenSource,
    },
    defaultEntityPrefix: config.defaultEntityPrefix,
    debugLogging: config.debugLogging,
    dataDir: config.dataDir,
  });
});

app.get("/api/ha/status", async (_req, res) => {
  try {
    const states = await haClient.getStates();
    addDebugLog("ha.status", "Home Assistant states read", { stateCount: states.length }, config.debugLogging);
    res.json({ ok: true, stateCount: states.length });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to connect Home Assistant",
    });
  }
});

app.get("/api/c4004/state", async (req, res) => {
  try {
    const prefix = getPrefix(req.query.prefix);
    const states = await haClient.getStates();
    const c4004State = buildC4004State(states, prefix);
    addDebugLog(
      "c4004.state",
      `prefix=${prefix} matched=${c4004State.entities.length - c4004State.missing.length}/${
        c4004State.entities.length
      }`,
      {
        prefix,
        missing: c4004State.missing,
        matchedEntities: c4004State.entities
          .filter((entity) => entity.exists)
          .map((entity) => `${entity.entityId}=${entity.state}`),
      },
      config.debugLogging,
    );
    res.json({
      ok: true,
      ...c4004State,
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to read C4004 state",
    });
  }
});

app.get("/api/c4004/discover", async (_req, res) => {
  try {
    const states = await haClient.getStates();
    let candidates: C4004DiscoveryCandidate[] = [];
    try {
      const [entityRegistry, deviceRegistry] = await Promise.all([
        haClient.getEntityRegistry(),
        haClient.getDeviceRegistry(),
      ]);
      candidates = discoverC4004CandidatesFromRegistries(states, entityRegistry, deviceRegistry);
      if (!candidates.length) {
        candidates = enrichC4004CandidatesWithDeviceInfo(
          discoverC4004Candidates(states),
          states,
          entityRegistry,
          deviceRegistry,
        );
      }
    } catch (error) {
      addDebugLog(
        "c4004.discover",
        "failed to read Home Assistant registries, falling back to state discovery",
        { error: error instanceof Error ? error.message : String(error) },
        true,
      );
      candidates = discoverC4004Candidates(states);
    }
    const allCandidates = candidates;
    candidates = candidates.filter((candidate) => candidate.status === "online");
    const devices = await deviceStorage.replaceFromDiscovery(candidates);
    addDebugLog(
      "c4004.discover",
      `scanned=${states.length} candidates=${candidates
        .map((candidate) => `${candidate.prefix}:${candidate.score}`)
        .join(", ")}`,
      {
        stateCount: states.length,
        candidates,
        offlineCandidates: allCandidates.filter((candidate) => candidate.status !== "online"),
      },
      true,
    );
    if (config.debugLogging) {
      const related = states
        .filter((state) => {
          const friendlyName = state.attributes?.friendly_name;
          return (
            state.entity_id.includes("c4004") ||
            (typeof friendlyName === "string" && friendlyName.toLowerCase().includes("c4004"))
          );
        })
        .map((state) => `${state.entity_id}=${state.state}`)
        .join(", ");
      addDebugLog("c4004.discover", "related states", { related: related || "none" }, true);
    }
    res.json({
      ok: true,
      candidates,
      devices,
      stateCount: states.length,
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to discover C4004 entities",
    });
  }
});

app.get("/api/c4004/devices", (_req, res) => {
  try {
    res.json({
      ok: true,
      devices: deviceStorage.listDevices(),
      updatedAt: deviceStorage.getUpdatedAt(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to read saved C4004 devices",
    });
  }
});

const parseDevicePatch = (body: unknown): StoredC4004DevicePatch => {
  const source = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const patch: StoredC4004DevicePatch = {};

  if (typeof source.name === "string" && source.name.trim().length > 0) {
    patch.name = source.name.trim();
  }
  if (typeof source.bound === "boolean") {
    patch.bound = source.bound;
  }
  if (typeof source.initialized === "boolean") {
    patch.initialized = source.initialized;
  }

  return patch;
};

app.put("/api/c4004/devices/:deviceId", async (req, res) => {
  try {
    const patch = parseDevicePatch(req.body);
    const device = await deviceStorage.updateDevice(req.params.deviceId, patch);
    if (!device) {
      res.status(404).json({ ok: false, error: "Saved C4004 device not found" });
      return;
    }

    res.json({
      ok: true,
      device,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to update saved C4004 device",
    });
  }
});

app.get("/api/debug/logs", (_req, res) => {
  res.json({
    ok: true,
    logs: getDebugLogs(),
  });
});

app.post("/api/c4004/write", async (req, res) => {
  try {
    const prefix = getPrefix(req.body?.prefix);
    const states = prefix === "auto" ? await haClient.getStates() : undefined;
    const entity = findWritableEntity(prefix, req.body?.key, req.body?.entityId, states);
    if (!entity) {
      res.status(400).json({ ok: false, error: "Unknown or read-only C4004 entity" });
      return;
    }

    addDebugLog(
      "c4004.write",
      `key=${req.body?.key ?? "-"} entity=${toEntityId(entity)} value=${req.body?.value}`,
      {
        prefix,
        key: req.body?.key,
        entityId: toEntityId(entity),
        value: req.body?.value,
      },
      config.debugLogging,
    );
    await writeC4004Entity(haClient, entity, req.body?.value);

    let state = null;
    try {
      state = await haClient.getState(toEntityId(entity));
    } catch {
      state = null;
    }

    res.json({
      ok: true,
      entityId: toEntityId(entity),
      domain: entity.domain,
      state,
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to write C4004 entity",
    });
  }
});

const frontendDist = path.resolve(process.cwd(), config.frontendDist);
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

app.listen(config.port, () => {
  const devicesDir = deviceStorage.getDevicesDir();
  const deviceCount = deviceStorage.listDevices().length;
  console.log(`DFRobot C4004 app listening on ${config.port}`);
  console.log(`Device storage dataDir: ${deviceStorage.getDataDir()}`);
  console.log(`Device storage devicesDir: ${devicesDir} (saved devices: ${deviceCount})`);
  addDebugLog(
    "storage",
    "device persistence paths",
    {
      dataDir: deviceStorage.getDataDir(),
      devicesDir,
      savedDeviceCount: deviceCount,
    },
    true,
  );
});
