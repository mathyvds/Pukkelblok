import fs from "node:fs";
import path from "node:path";
import type { Report } from "../shared/protocol";

export type KickRecord = {
  identity: string;
  sid: string;
  name: string;
  at: number;
};

export type HostPersist = {
  reports: Report[];
  kicked: KickRecord[];
};

const empty: HostPersist = { reports: [], kicked: [] };

export function loadHostState(filePath: string): HostPersist {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw) as Partial<HostPersist>;
    return {
      reports: Array.isArray(data.reports) ? data.reports : [],
      kicked: Array.isArray(data.kicked) ? data.kicked : [],
    };
  } catch {
    return { reports: [], kicked: [] };
  }
}

export function saveHostState(filePath: string, state: HostPersist) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, filePath);
}
