export interface DebugLogEntry {
  id: number;
  timestamp: string;
  scope: string;
  message: string;
  data?: unknown;
}

const maxEntries = 200;
let nextId = 1;
const entries: DebugLogEntry[] = [];

export const addDebugLog = (scope: string, message: string, data?: unknown, echo = true) => {
  const entry: DebugLogEntry = {
    id: nextId,
    timestamp: new Date().toISOString(),
    scope,
    message,
    data,
  };
  nextId += 1;
  entries.unshift(entry);
  if (entries.length > maxEntries) {
    entries.length = maxEntries;
  }

  if (echo) {
    const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
    console.log(`[${scope}] ${message}${suffix}`);
  }
};

export const getDebugLogs = () => entries;
