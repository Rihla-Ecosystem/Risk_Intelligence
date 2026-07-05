import { createHash } from "crypto";
import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";

export const fcdoAdvisory: SourceAdapter = {
  name: "fcdo_advisory",
  intervalMinutes: 720,
  enabled: true,

  buildRequest() {
    return { url: "https://www.gov.uk/api/content/foreign-travel-advice/egypt" };
  },

  parse(raw: any, checkpoint: Checkpoint): RiskEvent[] {
    const text = JSON.stringify(raw);
    const hash = createHash("sha256").update(text).digest("hex");
    if (checkpoint.contentHash === hash) return [];

    const summary = raw?.details?.summary ?? "FCDO travel advice updated for Egypt";

    return [{
      source: "fcdo_advisory",
      category: "advisory",
      severity: "advisory",
      city: null,
      lat: 0,
      lon: 0,
      headline: "UK FCDO travel advice updated",
      detail: summary,
      effectiveTime: raw?.public_updated_at ?? new Date().toISOString(),
      rawRef: "https://www.gov.uk/foreign-travel-advice/egypt",
    }];
  },

  nextCheckpoint(raw: any, _events: RiskEvent[], prev: Checkpoint): Checkpoint {
    const hash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
    return { ...prev, contentHash: hash, lastUpdateTime: new Date().toISOString() };
  },
};