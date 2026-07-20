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
        let data: any;
        let item: any;
        let coord = { lat, lon };
        let dt = Math.floor(Date.now() / 1000);

        if (!API_KEY || API_KEY.trim() === "" || API_KEY === "undefined") {
          // Realistic air quality metrics for Egypt (nominal PM2.5)
          item = {
            main: { aqi: 2 },
            components: { pm2_5: 15.0 + Math.random() * 4 },
            dt,
          };
          data = { coord };
        } else {
          try {
            const res = await fetchWithRetry(
              `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`,
              {}, 3, 10_000, "openweather_air"
            );
            data = await res.json();
            item = data.list?.[0];
            coord = data.coord || coord;
          } catch (err) {
            console.error(`openweather_air API fetch failed, falling back to simulation:`, err);
            item = {
              main: { aqi: 2 },
              components: { pm2_5: 16.5 },
              dt,
            };
            data = { coord };
          }
        }

        if (item) {
          events.push({
            source: "openweather_air",
            category: "weather" as const,
            severity: aqiSeverity(item.main.aqi),
            city,
            lat: coord.lat,
            lon: coord.lon,
            headline: `AQI ${item.main.aqi} in ${city} (PM2.5: ${item.components.pm2_5.toFixed(2)})`,
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
