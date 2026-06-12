import {
  HomeAssistantClient,
  HomeAssistantDeviceRegistryEntry,
  HomeAssistantEntityRegistryEntry,
  HomeAssistantState,
} from "./haClient";

export type EntityDomain = "binary_sensor" | "sensor" | "text_sensor" | "switch" | "select" | "number" | "button";
export type EntityAccess = "read" | "write" | "readwrite" | "action";

export interface C4004EntityDefinition {
  key: string;
  label: string;
  domain: EntityDomain;
  slug: string;
  entityIdOverride?: string;
  group: string;
  access: EntityAccess;
  valueType?: "boolean" | "number" | "select" | "button";
  options?: string[];
  dangerous?: boolean;
  applyHint?: string;
}

export interface C4004EntityState extends C4004EntityDefinition {
  entityId: string;
  exists: boolean;
  state: string | null;
  available: boolean;
  attributes: Record<string, unknown> | null;
  lastChanged: string | null;
  lastUpdated: string | null;
}

export interface C4004DiscoveryCandidate {
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

const normalizeStateValue = (value?: string | null) => (typeof value === "string" ? value.toLowerCase() : "");

const isOnlineStateValue = (value?: string | null) => {
  const normalized = normalizeStateValue(value);
  return normalized === "on" || normalized === "online" || normalized === "true";
};

const getCandidateStatus = (candidate: C4004DiscoveryCandidate): "online" | "offline" => {
  const onlineEntity = candidate.entities.find((entity) => entity.key === "online");
  return onlineEntity && isOnlineStateValue(onlineEntity.state) ? "online" : "offline";
};

const normalizeMacAddress = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const compact = value.trim().replace(/[^a-fA-F0-9]/g, "");
  if (compact.length !== 12) {
    return undefined;
  }

  return compact
    .match(/.{1,2}/g)
    ?.join(":")
    .toUpperCase();
};

const extractMacFromDevice = (device?: HomeAssistantDeviceRegistryEntry): string | undefined => {
  if (!device) {
    return undefined;
  }

  const pairs = [...(device.connections ?? []), ...(device.identifiers ?? [])];
  for (const [kind, value] of pairs) {
    const normalizedKind = String(kind ?? "").toLowerCase();
    const mac = normalizeMacAddress(value);
    if (mac && (normalizedKind.includes("mac") || normalizedKind.includes("esphome"))) {
      return mac;
    }
  }

  for (const [, value] of pairs) {
    const mac = normalizeMacAddress(value);
    if (mac) {
      return mac;
    }
  }

  return undefined;
};

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const getDeviceDisplayName = (device: HomeAssistantDeviceRegistryEntry): string | undefined =>
  normalizeOptionalString(device.name_by_user) ?? normalizeOptionalString(device.name) ?? undefined;

const isC4004RegistryDevice = (device: HomeAssistantDeviceRegistryEntry): boolean => {
  const combined = [device.name_by_user, device.name, device.manufacturer, device.model]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return combined.includes("c4004") || (combined.includes("dfrobot") && combined.includes("c4004"));
};

const objectIdFromEntityId = (entityId: string) => entityId.split(".", 2)[1] ?? "";

const findMacStateForPrefix = (states: HomeAssistantState[], prefix: string): string | undefined => {
  if (!prefix || prefix === "auto") {
    return undefined;
  }

  const candidates = states.filter((state) => {
    const objectId = objectIdFromEntityId(state.entity_id);
    return objectId.startsWith(`${prefix}_`) && objectId.endsWith("_mac_address");
  });

  for (const state of candidates) {
    const mac = normalizeMacAddress(state.state);
    if (mac) {
      return mac;
    }
  }

  return undefined;
};

const selectDeviceIdForCandidate = (
  candidate: C4004DiscoveryCandidate,
  registryByEntityId: Map<string, HomeAssistantEntityRegistryEntry>,
): string | undefined => {
  const counts = new Map<string, number>();
  for (const entity of candidate.entities) {
    const deviceId = registryByEntityId.get(entity.entityId)?.device_id;
    if (deviceId) {
      counts.set(deviceId, (counts.get(deviceId) ?? 0) + 1);
    }
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
};

const candidatePhysicalKey = (candidate: C4004DiscoveryCandidate): string | undefined => {
  if (candidate.deviceId) {
    return `device:${candidate.deviceId}`;
  }
  if (candidate.macAddress) {
    return `mac:${candidate.macAddress}`;
  }
  return undefined;
};

const isBetterDiscoveryCandidate = (
  candidate: C4004DiscoveryCandidate,
  current: C4004DiscoveryCandidate,
): boolean => {
  if (current.prefix === "auto" && candidate.prefix !== "auto") {
    return true;
  }
  if (candidate.prefix === "auto" && current.prefix !== "auto") {
    return false;
  }
  if (candidate.entities.length !== current.entities.length) {
    return candidate.entities.length > current.entities.length;
  }
  if (candidate.score !== current.score) {
    return candidate.score > current.score;
  }
  return candidate.prefix.localeCompare(current.prefix) < 0;
};

const dedupePhysicalCandidates = (candidates: C4004DiscoveryCandidate[]): C4004DiscoveryCandidate[] => {
  const keyed = new Map<string, C4004DiscoveryCandidate>();
  const unkeyed: C4004DiscoveryCandidate[] = [];

  for (const candidate of candidates) {
    const key = candidatePhysicalKey(candidate);
    if (!key) {
      unkeyed.push(candidate);
      continue;
    }

    const current = keyed.get(key);
    if (!current || isBetterDiscoveryCandidate(candidate, current)) {
      keyed.set(key, candidate);
    }
  }

  return [...keyed.values(), ...unkeyed];
};

const readEntities: C4004EntityDefinition[] = [
  { key: "online", label: "Online", domain: "binary_sensor", slug: "online", group: "系统功能", access: "read" },
  {
    key: "presence",
    label: "Presence",
    domain: "binary_sensor",
    slug: "presence",
    group: "人体存在功能",
    access: "read",
  },
  {
    key: "peopleCount",
    label: "People Count",
    domain: "sensor",
    slug: "people_count",
    group: "人数统计功能",
    access: "read",
  },
  {
    key: "targetCount",
    label: "Target Count",
    domain: "sensor",
    slug: "target_count",
    group: "轨迹跟踪功能",
    access: "read",
  },
  {
    key: "motionState",
    label: "Motion State",
    domain: "sensor",
    slug: "motion_state",
    group: "人体存在功能",
    access: "read",
  },
  {
    key: "detectionRangeMode",
    label: "Detection Range Mode",
    domain: "text_sensor",
    slug: "detection_range_mode",
    group: "雷达探测范围限制信息",
    access: "read",
  },
  { key: "status", label: "Status", domain: "text_sensor", slug: "status", group: "工作状态", access: "read" },
];

const controlEntities: C4004EntityDefinition[] = [
  {
    key: "presenceEnable",
    label: "Presence Enable",
    domain: "switch",
    slug: "presence_enable",
    group: "人体存在功能",
    access: "readwrite",
    valueType: "boolean",
  },
  {
    key: "trajectoryTrackingEnable",
    label: "Trajectory Tracking Enable",
    domain: "switch",
    slug: "trajectory_tracking_enable",
    group: "轨迹跟踪功能",
    access: "readwrite",
    valueType: "boolean",
  },
  {
    key: "trajectoryRangeMode",
    label: "Trajectory Range Mode",
    domain: "switch",
    slug: "trajectory_range_mode",
    group: "轨迹跟踪功能",
    access: "readwrite",
    valueType: "boolean",
  },
  {
    key: "trajectoryLed",
    label: "Trajectory LED",
    domain: "switch",
    slug: "trajectory_led",
    group: "轨迹跟踪功能",
    access: "readwrite",
    valueType: "boolean",
  },
  {
    key: "motionLed",
    label: "Motion LED",
    domain: "switch",
    slug: "motion_led",
    group: "轨迹跟踪功能",
    access: "readwrite",
    valueType: "boolean",
  },
  {
    key: "installMode",
    label: "Install Mode",
    domain: "select",
    slug: "install_mode",
    group: "雷达安装信息",
    access: "readwrite",
    valueType: "select",
    options: ["Side", "Top"],
    applyHint: "Press Set Install Info after changing this value.",
  },
  {
    key: "installHeight",
    label: "Install Height",
    domain: "number",
    slug: "install_height",
    group: "雷达安装信息",
    access: "readwrite",
    valueType: "number",
    applyHint: "Press Set Install Info after changing this value.",
  },
  {
    key: "installZAngle",
    label: "Install Z Angle",
    domain: "number",
    slug: "install_z_angle",
    group: "雷达安装信息",
    access: "readwrite",
    valueType: "number",
    applyHint: "Press Set Install Info after changing this value.",
  },
  {
    key: "rangeXMax",
    label: "Range X Max",
    domain: "number",
    slug: "range_x_max",
    group: "雷达探测范围限制信息",
    access: "readwrite",
    valueType: "number",
    applyHint: "Press Set Four-sided Range Mode after changing this value.",
  },
  {
    key: "rangeXMin",
    label: "Range X Min",
    domain: "number",
    slug: "range_x_min",
    group: "雷达探测范围限制信息",
    access: "readwrite",
    valueType: "number",
    applyHint: "Press Set Four-sided Range Mode after changing this value.",
  },
  {
    key: "rangeYMax",
    label: "Range Y Max",
    domain: "number",
    slug: "range_y_max",
    group: "雷达探测范围限制信息",
    access: "readwrite",
    valueType: "number",
    applyHint: "Press Set Four-sided Range Mode after changing this value.",
  },
  {
    key: "rangeYMin",
    label: "Range Y Min",
    domain: "number",
    slug: "range_y_min",
    group: "雷达探测范围限制信息",
    access: "readwrite",
    valueType: "number",
    applyHint: "Press Set Four-sided Range Mode after changing this value.",
  },
  {
    key: "realTimePeopleTime",
    label: "Real-time People Time",
    domain: "number",
    slug: "real_time_people_time",
    group: "人数统计功能",
    access: "readwrite",
    valueType: "number",
  },
  {
    key: "trackMeters",
    label: "Track Meters",
    domain: "number",
    slug: "track_meters",
    group: "人数统计功能",
    access: "readwrite",
    valueType: "number",
  },
  {
    key: "trackExistsTime",
    label: "Track Exists Time",
    domain: "number",
    slug: "track_exists_time",
    group: "人数统计功能",
    access: "readwrite",
    valueType: "number",
  },
  {
    key: "unmannedTime",
    label: "Unmanned Time",
    domain: "number",
    slug: "unmanned_time",
    group: "人数统计功能",
    access: "readwrite",
    valueType: "number",
  },
  {
    key: "factoryReset",
    label: "Factory Reset",
    domain: "button",
    slug: "factory_reset",
    group: "系统功能",
    access: "action",
    valueType: "button",
    dangerous: true,
  },
  {
    key: "reset",
    label: "Reset",
    domain: "button",
    slug: "reset",
    group: "系统功能",
    access: "action",
    valueType: "button",
  },
  {
    key: "setInstallInfo",
    label: "Set Install Info",
    domain: "button",
    slug: "set_install_info",
    group: "雷达安装信息",
    access: "action",
    valueType: "button",
  },
  {
    key: "setFourSidedRangeMode",
    label: "Set Four-sided Range Mode",
    domain: "button",
    slug: "set_four_sided_range_mode",
    group: "雷达探测范围限制信息",
    access: "action",
    valueType: "button",
  },
  {
    key: "updateTrajectoryRangeMode",
    label: "Update Trajectory Range Mode",
    domain: "button",
    slug: "update_trajectory_range_mode",
    group: "轨迹跟踪功能",
    access: "action",
    valueType: "button",
  },
  {
    key: "clearAllTags",
    label: "Clear All Tags",
    domain: "button",
    slug: "clear_all_tags",
    group: "雷达探测范围限制信息",
    access: "action",
    valueType: "button",
  },
  {
    key: "clearPeopleCount",
    label: "Clear People Count",
    domain: "button",
    slug: "clear_people_count",
    group: "人数统计功能",
    access: "action",
    valueType: "button",
  },
];

export const buildC4004Entities = (prefix: string): C4004EntityDefinition[] => [
  ...readEntities,
  ...controlEntities,
].map((entity) => ({ ...entity, slug: `${prefix}_${entity.slug}` }));

const baseDefinitions = (): C4004EntityDefinition[] => [...readEntities, ...controlEntities];

export const toEntityId = (definition: C4004EntityDefinition): string =>
  definition.entityIdOverride ?? `${definition.domain}.${definition.slug}`;

const isAvailable = (state?: HomeAssistantState): boolean =>
  Boolean(state && state.state !== "unavailable" && state.state !== "unknown");

const isAutoPrefix = (prefix: string): boolean => prefix.toLowerCase() === "auto";

const sortedDefinitions = (): C4004EntityDefinition[] =>
  baseDefinitions().sort((left, right) => right.slug.length - left.slug.length);

const matchC4004State = (state: HomeAssistantState) => {
  const [domain, objectId] = state.entity_id.split(".");
  if (!domain || !objectId) {
    return undefined;
  }

  for (const definition of sortedDefinitions()) {
    if (definition.domain !== domain) {
      continue;
    }

    let prefix: string | undefined;
    if (objectId === definition.slug) {
      prefix = "";
    } else if (objectId.endsWith(`_${definition.slug}`)) {
      prefix = objectId.slice(0, objectId.length - definition.slug.length - 1);
    }

    if (prefix !== undefined) {
      return {
        definition,
        prefix,
        objectId,
        state,
      };
    }
  }

  return undefined;
};

const selectAutoMatches = (states: HomeAssistantState[]) => {
  const matches = states.map(matchC4004State).filter((match): match is NonNullable<typeof match> => Boolean(match));
  const prefixScores = new Map<string, number>();
  for (const match of matches) {
    prefixScores.set(match.prefix, (prefixScores.get(match.prefix) ?? 0) + 1);
  }

  const scored = matches
    .map((match) => {
      const availableScore = isAvailable(match.state) ? 1000 : 0;
      const prefixScore = (prefixScores.get(match.prefix) ?? 0) * 10;
      const nameScore = match.prefix.includes("c4004") ? 5 : 0;
      return {
        ...match,
        score: availableScore + prefixScore + nameScore,
      };
    })
    .sort((left, right) => right.score - left.score);

  const byKey = new Map<string, (typeof scored)[number]>();
  for (const match of scored) {
    if (!byKey.has(match.definition.key)) {
      byKey.set(match.definition.key, match);
    }
  }
  return byKey;
};

const buildEntityState = (definition: C4004EntityDefinition, state?: HomeAssistantState): C4004EntityState => {
  const entityId = toEntityId(definition);
  return {
    ...definition,
    entityId,
    exists: Boolean(state),
    state: state?.state ?? null,
    available: isAvailable(state),
    attributes: state?.attributes ?? null,
    lastChanged: state?.last_changed ?? null,
    lastUpdated: state?.last_updated ?? null,
  };
};

const toStateResponse = (prefix: string, entities: C4004EntityState[]) => ({
  prefix,
  entities,
  missing: entities.filter((entity) => !entity.exists).map((entity) => entity.entityId),
  readable: Object.fromEntries(
    entities
      .filter((entity) => entity.access === "read" || entity.access === "readwrite")
      .map((entity) => [entity.key, entity.state]),
  ),
  writable: entities.filter((entity) => entity.access !== "read"),
});

const buildAutoC4004State = (states: HomeAssistantState[]) => {
  const selected = selectAutoMatches(states);
  const entities = baseDefinitions().map((definition) => {
    const match = selected.get(definition.key);
    if (!match) {
      return buildEntityState(definition);
    }
    return buildEntityState(
      {
        ...definition,
        slug: match.objectId,
        entityIdOverride: match.state.entity_id,
      },
      match.state,
    );
  });

  return toStateResponse("auto", entities);
};

export const buildC4004State = (states: HomeAssistantState[], prefix: string) => {
  if (isAutoPrefix(prefix)) {
    return buildAutoC4004State(states);
  }

  const byId = new Map(states.map((state) => [state.entity_id, state]));
  const entities: C4004EntityState[] = buildC4004Entities(prefix).map((definition) =>
    buildEntityState(definition, byId.get(toEntityId(definition))),
  );

  return toStateResponse(prefix, entities);
};

export const findWritableEntity = (
  prefix: string,
  key?: string,
  entityId?: string,
  states?: HomeAssistantState[],
): C4004EntityDefinition | undefined => {
  if (isAutoPrefix(prefix) && states) {
    const state = buildAutoC4004State(states).entities.find((entity) => {
      if (entity.access === "read" || !entity.exists) {
        return false;
      }
      return entity.key === key || entity.entityId === entityId;
    });
    return state ? { ...state, entityIdOverride: state.entityId } : undefined;
  }

  return buildC4004Entities(prefix).find((entity) => {
    if (entity.access === "read") {
      return false;
    }
    return entity.key === key || toEntityId(entity) === entityId;
  });
};

export const discoverC4004Candidates = (states: HomeAssistantState[]): C4004DiscoveryCandidate[] => {
  const candidates = new Map<string, C4004DiscoveryCandidate>();

  for (const state of states) {
    const match = matchC4004State(state);
    if (!match) {
      continue;
    }

    const candidate = candidates.get(match.prefix) ?? { prefix: match.prefix, score: 0, entities: [] };
    if (
      !candidate.entities.some((entity) => entity.key === match.definition.key && entity.entityId === state.entity_id)
    ) {
      candidate.score += 1;
      candidate.entities.push({
        key: match.definition.key,
        label: match.definition.label,
        entityId: state.entity_id,
        state: state.state,
      });
    }
    candidates.set(match.prefix, candidate);
  }

  const autoState = buildAutoC4004State(states);
  const autoCandidate: C4004DiscoveryCandidate = {
    prefix: "auto",
    score: autoState.entities.length - autoState.missing.length,
    entities: autoState.entities
      .filter((entity) => entity.exists)
      .map((entity) => ({
        key: entity.key,
        label: entity.label,
        entityId: entity.entityId,
        state: entity.state ?? "",
      })),
  };

  return [autoCandidate, ...candidates.values()]
    .filter((candidate) => candidate.score >= 2 || candidate.prefix.includes("c4004"))
    .map((candidate) => ({
      ...candidate,
      status: getCandidateStatus(candidate),
    }))
    .sort((left, right) => {
      if (left.prefix === "auto") {
        return -1;
      }
      if (right.prefix === "auto") {
        return 1;
      }
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.prefix.localeCompare(right.prefix);
    })
    .slice(0, 12);
};

export const discoverC4004CandidatesFromRegistries = (
  states: HomeAssistantState[],
  entityRegistry: HomeAssistantEntityRegistryEntry[],
  deviceRegistry: HomeAssistantDeviceRegistryEntry[],
): C4004DiscoveryCandidate[] => {
  const stateByEntityId = new Map(states.map((state) => [state.entity_id, state]));
  const entitiesByDeviceId = new Map<string, HomeAssistantEntityRegistryEntry[]>();

  for (const entry of entityRegistry) {
    if (!entry.device_id) {
      continue;
    }

    const entries = entitiesByDeviceId.get(entry.device_id) ?? [];
    entries.push(entry);
    entitiesByDeviceId.set(entry.device_id, entries);
  }

  const candidates: C4004DiscoveryCandidate[] = [];
  for (const device of deviceRegistry) {
    const entries = entitiesByDeviceId.get(device.id) ?? [];
    const byPrefix = new Map<string, C4004DiscoveryCandidate>();

    for (const entry of entries) {
      if (entry.disabled_by) {
        continue;
      }

      const state = stateByEntityId.get(entry.entity_id);
      if (!state) {
        continue;
      }

      const match = matchC4004State(state);
      if (!match) {
        continue;
      }

      const candidate = byPrefix.get(match.prefix) ?? { prefix: match.prefix, score: 0, entities: [] };
      if (!candidate.entities.some((entity) => entity.key === match.definition.key)) {
        candidate.score += isAvailable(state) ? 2 : 1;
        candidate.entities.push({
          key: match.definition.key,
          label: match.definition.label,
          entityId: state.entity_id,
          state: state.state,
        });
      }
      byPrefix.set(match.prefix, candidate);
    }

    const matchedCandidates = [...byPrefix.values()].sort((left, right) => {
      if (right.entities.length !== left.entities.length) {
        return right.entities.length - left.entities.length;
      }
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.prefix.localeCompare(right.prefix);
    });
    const bestCandidate = matchedCandidates[0];
    if (!bestCandidate || (!isC4004RegistryDevice(device) && bestCandidate.entities.length < 2)) {
      continue;
    }

    candidates.push({
      ...bestCandidate,
      status: getCandidateStatus(bestCandidate),
      deviceId: device.id,
      deviceName: getDeviceDisplayName(device),
      manufacturer: normalizeOptionalString(device.manufacturer),
      deviceModel: normalizeOptionalString(device.model),
      firmwareVersion: normalizeOptionalString(device.sw_version),
      macAddress: extractMacFromDevice(device) ?? findMacStateForPrefix(states, bestCandidate.prefix),
    });
  }

  return dedupePhysicalCandidates(candidates).sort((left, right) => {
    if (right.entities.length !== left.entities.length) {
      return right.entities.length - left.entities.length;
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.prefix.localeCompare(right.prefix);
  });
};

export const enrichC4004CandidatesWithDeviceInfo = (
  candidates: C4004DiscoveryCandidate[],
  states: HomeAssistantState[],
  entityRegistry: HomeAssistantEntityRegistryEntry[],
  deviceRegistry: HomeAssistantDeviceRegistryEntry[],
): C4004DiscoveryCandidate[] => {
  const registryByEntityId = new Map(entityRegistry.map((entry) => [entry.entity_id, entry]));
  const deviceById = new Map(deviceRegistry.map((device) => [device.id, device]));

  const enrichedCandidates = candidates.map((candidate) => {
    const deviceId = selectDeviceIdForCandidate(candidate, registryByEntityId);
    const device = deviceId ? deviceById.get(deviceId) : undefined;
    const macAddress = extractMacFromDevice(device) ?? findMacStateForPrefix(states, candidate.prefix);

    return {
      ...candidate,
      status: getCandidateStatus(candidate),
      deviceId,
      deviceName: device ? getDeviceDisplayName(device) : undefined,
      manufacturer: normalizeOptionalString(device?.manufacturer),
      deviceModel: normalizeOptionalString(device?.model),
      firmwareVersion: normalizeOptionalString(device?.sw_version),
      macAddress,
    };
  });

  return dedupePhysicalCandidates(enrichedCandidates);
};

export const writeC4004Entity = async (
  client: HomeAssistantClient,
  entity: C4004EntityDefinition,
  value: unknown,
) => {
  const entityId = toEntityId(entity);

  if (entity.domain === "switch") {
    const state = value === true || value === "on" || value === "true" || value === 1;
    return client.callService("switch", state ? "turn_on" : "turn_off", { entity_id: entityId });
  }

  if (entity.domain === "number") {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      throw new Error(`Invalid numeric value for ${entityId}`);
    }
    return client.callService("number", "set_value", { entity_id: entityId, value: nextValue });
  }

  if (entity.domain === "select") {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Invalid select option for ${entityId}`);
    }
    return client.callService("select", "select_option", { entity_id: entityId, option: value });
  }

  if (entity.domain === "button") {
    return client.callService("button", "press", { entity_id: entityId });
  }

  throw new Error(`Unsupported writable entity: ${entityId}`);
};
