import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";
import { nearestCity } from "../../engine/models.js";
import { earthquakeSeverity } from "../../severity/rules.js";

export const emscSeismic: SourceAdapter = {
  name: "emsc_seismic",
  intervalMinutes: 15,
  enabled: true,

  buildRequest(checkpoint: Checkpoint) {
    const startTime = checkpoint.lastUpdateTime
      ?? new Date(Date.now() - 24 * 3600_000).toISOString();
    const params = new URLSearchParams({
      format: "json",
      minmag: "3",
      lat: "27",
      lon: "30",
      maxradius: "10",
      starttime: startTime,
    });
    return { url: `https://www.seismicportal.eu/fdsnws/event/1/query?${params}` };
  },

  parse(raw: any): RiskEvent[] {
    return (raw.features ?? []).map((f: any) => {
      const [lon, lat] = f.geometry.coordinates;
      const mag = f.properties.mag;
      return {
        source: "emsc_seismic",
        category: "seismic",
        severity: earthquakeSeverity(mag),
        city: nearestCity(lat, lon),
        lat,
        lon,
        headline: `M${mag} — ${f.properties.flynn_region}`,
        effectiveTime: f.properties.time,
        rawRef: f.properties.source_id ?? f.id,
      };
    });
  },

  nextCheckpoint(_raw: any, _events: RiskEvent[], prev: Checkpoint): Checkpoint {
    return { ...prev, lastUpdateTime: new Date().toISOString() };
  },
};