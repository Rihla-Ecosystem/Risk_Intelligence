import { createHash } from "crypto";
import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";
import { advisoryLevelSeverity } from "../../severity/rules.js";

export const stateDeptAdvisory: SourceAdapter = {
  name: "state_dept_advisory",
  intervalMinutes: 720,
  enabled: true,

  buildRequest() {
    // NOTE: State Dept doesn't have a formal REST API — this consumes their
    // published advisory page/feed. Confirm current URL structure at integration time.
    return { url: "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/egypt-travel-advisory.html" };
  },

  parse(raw: any, checkpoint: Checkpoint): RiskEvent[] {
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const hash = createHash("sha256").update(text).digest("hex");

    // only emit an event if content actually changed since last poll
    if (checkpoint.contentHash === hash) return [];

    const levelMatch = text.match(/Level\s+(\d)/i);
    const level = levelMatch ? Number(levelMatch[1]) : 1;

    return [{
      source: "state_dept_advisory",
      category: "advisory",
      severity: advisoryLevelSeverity(level),
      city: null,
      lat: 0,
      lon: 0,
      headline: `US State Dept advisory level ${level} for Egypt`,
      effectiveTime: new Date().toISOString(),
      rawRef: "https://travel.state.gov",
    }];
  },

  nextCheckpoint(raw: any, _events: RiskEvent[], prev: Checkpoint): Checkpoint {
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const hash = createHash("sha256").update(text).digest("hex");
    return { ...prev, contentHash: hash, lastUpdateTime: new Date().toISOString() };
  },
};