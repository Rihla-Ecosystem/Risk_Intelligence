import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";
import { textSeverityClassifier } from "../../severity/rules.js";

export const reliefweb: SourceAdapter = {
  name: "reliefweb",
  intervalMinutes: 360,
  enabled: true,

  buildRequest() {
    // NOTE: V2 requires a pre-approved appname (register via ReliefWeb API form).
    // Without a registered appname, this endpoint returns 403.
    const params = new URLSearchParams({
      appname: "rihla-safety",
      "filter[field]": "country",
      "filter[value]": "Egypt",
    });
    return { url: `https://api.reliefweb.int/v2/reports?${params}` };
  },

  parse(raw: any): RiskEvent[] {
    return (raw.data ?? []).map((r: any) => ({
      source: "reliefweb",
      category: "unrest" as const,
      severity: textSeverityClassifier(r.fields.title ?? ""),
      city: null,
      lat: 0,
      lon: 0,
      headline: r.fields.title,
      effectiveTime: r.fields.date?.created ?? new Date().toISOString(),
      rawRef: r.fields.url ?? r.id,
    }));
  },

  nextCheckpoint(_raw: any, _events: RiskEvent[], prev: Checkpoint): Checkpoint {
    return { ...prev, lastUpdateTime: new Date().toISOString() };
  },
};
