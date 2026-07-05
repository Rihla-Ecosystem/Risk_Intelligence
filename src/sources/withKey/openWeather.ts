import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";
import { EGYPT_CITIES } from "../../engine/models.js";
import { uvIndexSeverity, tempSeverity } from "../../severity/rules.js";
import { fetchWithRetry } from "../../engine/httpClient.js";

const API_KEY = process.env.OPENWEATHER_API_KEY;

export const openWeather: SourceAdapter = {
  name: "openweather_current",
  intervalMinutes: 20,
  enabled: true,

  buildRequest() {
    // Not used directly — see fetchData below.
    return { url: "" };
  },

  async fetchData(): Promise<{ raw: unknown; events: RiskEvent[] }> {
    const events: RiskEvent[] = [];
    for (const [city, { lat, lon }] of Object.entries(EGYPT_CITIES)) {
      try {
        const [weatherRes, uviRes] = await Promise.all([
          fetchWithRetry(
            `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`,
            {}, 2, 8_000, "openweather_current"
          ),
          fetchWithRetry(
            `https://api.openweathermap.org/data/2.5/uvi?lat=${lat}&lon=${lon}&appid=${API_KEY}`,
            {}, 2, 8_000, "openweather_current"
          ),
        ]);
        const weather = await weatherRes.json();
        const uvi = await uviRes.json();
        events.push(...eventsForCity(city, { weather, uvi }));
      } catch (err) {
        console.error(`openweather_current failed for ${city}:`, err);
      }
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

function eventsForCity(city: string, data: { weather: any; uvi: any }): RiskEvent[] {
  const events: RiskEvent[] = [];
  const { weather, uvi } = data;
  const uv = uvi?.value;
  const temp = weather?.main?.temp;

  if (uv !== undefined) {
    events.push({
      source: "openweather_current",
      category: "weather",
      severity: uvIndexSeverity(uv),
      city,
      lat: weather?.coord?.lat ?? 0,
      lon: weather?.coord?.lon ?? 0,
      headline: `UV index ${uv} in ${city}`,
      effectiveTime: new Date().toISOString(),
      rawRef: "openweathermap.org",
    });
  }
  if (temp !== undefined) {
    const sev = tempSeverity(temp);
    events.push({
      source: "openweather_current",
      category: "weather",
      severity: sev,
      city,
      lat: weather?.coord?.lat ?? 0,
      lon: weather?.coord?.lon ?? 0,
      headline: sev === "critical" || sev === "warning"
        ? `EXTREME HEAT: ${temp}°C in ${city} — heatstroke risk, avoid midday sun`
        : `${temp}°C in ${city}`,
      detail: temp >= 43
        ? "Stay hydrated, avoid outdoor activity 11am–4pm, watch for heat exhaustion symptoms. Elderly tourists and those with health conditions are at highest risk."
        : undefined,
      effectiveTime: new Date().toISOString(),
      rawRef: "openweathermap.org",
    });
  }
  return events;
}
