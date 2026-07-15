import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";
import { EGYPT_CITIES } from "../../engine/models.js";
import { aqiSeverity } from "../../severity/rules.js";
import { fetchWithRetry } from "../../engine/httpClient.js";

const API_KEY = process.env.OPENWEATHER_API_KEY;

export const openWeatherAir: SourceAdapter = {
  name: "openweather_air",
  intervalMinutes: 30,
  enabled: true,

  buildRequest() {
    // Not used directly — see fetchData below.
    return { url: "" };
  },

  async fetchData(): Promise<{ raw: unknown; events: RiskEvent[] }> {
    const events: RiskEvent[] = [];
    let failed = 0;
    for (const [city, { lat, lon }] of Object.entries(EGYPT_CITIES)) {
      try {
        const res = await fetchWithRetry(
          `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`,
          {}, 3, 10_000, "openweather_air"
        );
        const data = await res.json();
        const item = data.list?.[0];
        if (item) {
          events.push({
            source: "openweather_air",
            category: "weather" as const,
            severity: aqiSeverity(item.main.aqi),
            city,
            lat: data.coord.lat,
            lon: data.coord.lon,
            headline: `AQI ${item.main.aqi} in ${city} (PM2.5: ${item.components.pm2_5})`,
            effectiveTime: new Date(item.dt * 1000).toISOString(),
            rawRef: `openweathermap.org::aqi::${city}`,
          });
        }
      } catch (err) {
        console.error(`openweather_air failed for ${city}:`, err);
        failed++;
      }
    }
    if (failed > 0) {
      const total = Object.keys(EGYPT_CITIES).length;
      console.warn(`openweather_air: ${failed}/${total} cities failed, ${events.length} events generated`);
    }
    return { raw: {}, events };
  },

  parse(_raw: any): RiskEvent[] {
    // Not used — see fetchData above.
    return [];
  },

  nextCheckpoint(_raw: any, _events: RiskEvent[], prev: Checkpoint): Checkpoint {
    return { ...prev, lastUpdateTime: new Date().toISOString() };
  },
};
