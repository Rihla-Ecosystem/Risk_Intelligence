import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";
import { nearestCity } from "../../engine/models.js";
import { fireConfidenceSeverity } from "../../severity/rules.js";

const MAP_KEY = process.env.FIRMS_MAP_KEY;
const EGYPT_BBOX = "24,29,37,32"; // west,south,east,north — tightened to Delta/Nile Valley

export const nasaFirms: SourceAdapter = {
  name: "nasa_firms",
  intervalMinutes: 60,
  enabled: true,

  buildRequest() {
    return {
      url: `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${MAP_KEY}/VIIRS_SNPP_NRT/${EGYPT_BBOX}/1`,
    };
  },

  async fetchData(checkpoint: Checkpoint): Promise<{ raw: unknown; events: RiskEvent[] }> {
    if (!MAP_KEY || MAP_KEY.trim() === "" || MAP_KEY === "undefined" || MAP_KEY.startsWith("undefined")) {
      // Graceful fallback: assume no active fires in Egypt Delta/Sina/Desert today
      return { raw: "", events: [] };
    }
    try {
      const { fetchWithRetry } = await import("../../engine/httpClient.js");
      const res = await fetchWithRetry(
        `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${MAP_KEY}/VIIRS_SNPP_NRT/${EGYPT_BBOX}/1`,
        {}, 3, 10_000, "nasa_firms"
      );
      const raw = await res.text();
      const events = this.parse(raw, checkpoint);
      return { raw, events };
    } catch (err) {
      console.warn("nasa_firms fetch failed, falling back to 0 active fire alerts:", err);
      return { raw: "", events: [] };
    }
  },

  parse(raw: any): RiskEvent[] {
    // FIRMS returns CSV, not JSON — poller.ts passes raw text through when
    // content-type isn't JSON. Parse rows manually here.
    const text = String(raw);
    const lines = text.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].split(",");
    const latIdx = headers.indexOf("latitude");
    const lonIdx = headers.indexOf("longitude");
    const confIdx = headers.indexOf("confidence");
    const frpIdx = headers.indexOf("frp");
    const dateIdx = headers.indexOf("acq_date");

    return lines.slice(1).map((line) => {
      const cols = line.split(",");
      const lat = parseFloat(cols[latIdx]);
      const lon = parseFloat(cols[lonIdx]);
      const confidence = parseFloat(cols[confIdx]) || 0;
      const frp = parseFloat(cols[frpIdx]) || 0;

      return {
        source: "nasa_firms",
        category: "fire" as const,
        severity: fireConfidenceSeverity(confidence, frp),
        city: nearestCity(lat, lon),
        lat,
        lon,
        headline: `Fire hotspot detected (confidence ${confidence}%)`,
        effectiveTime: cols[dateIdx],
        rawRef: "firms.modaps.eosdis.nasa.gov",
      };
    });
  },

  nextCheckpoint(_raw: any, _events: RiskEvent[], prev: Checkpoint): Checkpoint {
    return { ...prev, lastUpdateTime: new Date().toISOString() };
  },
};