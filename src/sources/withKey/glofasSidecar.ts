import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";

const execFileAsync = promisify(execFile);
const SIDECAR_PATH = path.join(process.cwd(), "src", "sidecars", "glofas", "glofas_fetch.py");

export const glofasSidecar: SourceAdapter = {
  name: "glofas_flood",
  intervalMinutes: 360,
  enabled: false, // flip on once sidecar + CDS license acceptance are confirmed working

  buildRequest() {
    return { url: "" };
  },

  async fetchData(): Promise<{ raw: unknown; events: RiskEvent[] }> {
    const { stdout } = await execFileAsync("python3", [SIDECAR_PATH], {
      env: { ...process.env },
      timeout: 120_000,
    });
    const parsed = JSON.parse(stdout);
    return { raw: parsed, events: parsed.events ?? [] };
  },

  parse(_raw: any): RiskEvent[] {
    return [];
  },

  nextCheckpoint(_raw: any, _events: RiskEvent[], prev: Checkpoint): Checkpoint {
    return { ...prev, lastUpdateTime: new Date().toISOString() };
  },
};
