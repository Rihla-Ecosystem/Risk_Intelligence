import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";
import { textSeverityClassifier } from "../../severity/rules.js";

export const gdeltUnrest: SourceAdapter = {
  name: "gdelt_unrest",
  intervalMinutes: 20,
  enabled: true,

  buildRequest() {
    const params = new URLSearchParams({
      query: "Egypt protest OR unrest OR clash",
      mode: "artlist",
      format: "json",
      maxrecords: "20",
      timespan: "1d",
    });
    return { url: `https://api.gdeltproject.org/api/v2/doc/doc?${params}` };
  },

  parse(raw: any): RiskEvent[] {
    return (raw.articles ?? []).map((a: any) => ({
      source: "gdelt_unrest",
      category: "unrest",
      severity: textSeverityClassifier(`${a.title ?? ""} ${a.url ?? ""}`),
      city: null,
      lat: 0,
      lon: 0,
      headline: a.title,
      detail: a.url,
      effectiveTime: a.seendate,
      rawRef: a.url,
    }));
  },

  nextCheckpoint(_raw: any, _events: RiskEvent[], prev: Checkpoint): Checkpoint {
    return { ...prev, lastUpdateTime: new Date().toISOString() };
  },
};
