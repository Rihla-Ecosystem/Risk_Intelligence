import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";

export const noaaTsunami: SourceAdapter = {
  name: "noaa_tsunami",
  intervalMinutes: 60,
  enabled: true,

  buildRequest() {
    return {
      url: "https://api.weather.gov/alerts/active?event=Tsunami+Warning,Tsunami+Watch,Tsunami+Advisory",
      init: { headers: { "User-Agent": "RihlaApp (contact@yourdomain.com)" } },
    };
  },

  parse(raw: any): RiskEvent[] {
    return (raw.features ?? []).map((f: any) => ({
      source: "noaa_tsunami",
      category: "tsunami",
      severity: f.properties.severity === "Extreme" ? "critical" : "warning",
      city: null,
      lat: 0,
      lon: 0,
      headline: f.properties.headline,
      detail: f.properties.description,
      effectiveTime: f.properties.effective,
      expiresTime: f.properties.expires,
      rawRef: f.properties.id,
    }));
  },

  nextCheckpoint(_raw: any, _events: RiskEvent[], prev: Checkpoint): Checkpoint {
    return { ...prev, lastUpdateTime: new Date().toISOString() };
  },
};