import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";
import { nearestCity } from "../../engine/models.js";
import { earthquakeSeverity } from "../../severity/rules.js";

const EGYPT_BBOX = { minlat: 21, maxlat: 32, minlon: 24, maxlon: 37 };

export const usgsEarthquake: SourceAdapter = {
  name: "usgs_earthquake",
  intervalMinutes: 15,
  enabled: true,

  buildRequest(checkpoint: Checkpoint) {
    const startTime = checkpoint.lastUpdateTime
      ?? new Date(Date.now() - 24 * 3600_000).toISOString();

    const params = new URLSearchParams({
      format: "geojson",
      minlatitude: String(EGYPT_BBOX.minlat),
      maxlatitude: String(EGYPT_BBOX.maxlat),
      minlongitude: String(EGYPT_BBOX.minlon),
      maxlongitude: String(EGYPT_BBOX.maxlon),
      starttime: startTime,
      minmagnitude: "3",
      eventtype: "earthquake",
      orderby: "time",
    });

    return { url: `https://earthquake.usgs.gov/fdsnws/event/1/query?${params}` };
  },

  parse(raw: any): RiskEvent[] {
    return (raw.features ?? []).map((f: any) => {
      const [lon, lat] = f.geometry.coordinates;
      return {
        source: "usgs_earthquake",
        category: "seismic",
        severity: earthquakeSeverity(f.properties.mag),
        city: nearestCity(lat, lon),
        lat,
        lon,
        headline: f.properties.title,
        detail: `Depth ${f.geometry.coordinates[2]}km, felt reports: ${f.properties.felt ?? 0}`,
        effectiveTime: new Date(f.properties.time).toISOString(),
        rawRef: f.properties.url,
      };
    });
  },

  nextCheckpoint(raw: any, _events: RiskEvent[], prev: Checkpoint): Checkpoint {
    return {
      ...prev,
      lastUpdateTime: new Date(raw.metadata.generated).toISOString(),
    };
  },
};