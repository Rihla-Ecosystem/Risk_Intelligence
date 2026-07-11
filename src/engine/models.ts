export type Severity = "info" | "advisory" | "warning" | "critical";
export type Category = "seismic" | "weather" | "fire" | "flood" | "unrest" | "health" | "crime" | "advisory" | "tsunami";

export interface RiskEvent {
  source: string;
  category: Category;
  severity: Severity;
  city: string | null;
  lat: number;
  lon: number;
  headline: string;
  detail?: string;
  effectiveTime: string;
  expiresTime?: string;
  rawRef: string;
}

export interface Checkpoint {
  lastUpdateTime: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  bootstrapped: boolean;
  [key: string]: unknown;
}

export interface SourceAdapter {
  name: string;
  intervalMinutes: number;
  enabled: boolean;
  /** Optional: per-request timeout in ms. Falls back to 10_000 in poller. */
  timeoutMs?: number;
  buildRequest(checkpoint: Checkpoint): { url: string; init?: RequestInit };
  parse(raw: unknown, checkpoint: Checkpoint): RiskEvent[];
  nextCheckpoint(raw: unknown, events: RiskEvent[], prev: Checkpoint): Checkpoint;
  /** Optional: if set, runSource() calls this instead of buildRequest→fetch→parse.
   *  The returned events are used directly for state merge. */
  fetchData?(checkpoint: Checkpoint): Promise<{
    raw: unknown;
    events: RiskEvent[];
  }>;
}

export const EGYPT_CITIES: Record<string, { lat: number; lon: number }> = {
  cairo: { lat: 30.0444, lon: 31.2357 },
  giza: { lat: 29.9773, lon: 31.1325 },
  alexandria: { lat: 31.2001, lon: 29.9187 },
  luxor: { lat: 25.6872, lon: 32.6396 },
  aswan: { lat: 24.0889, lon: 32.8998 },
  hurghada: { lat: 27.2579, lon: 33.8116 },
  sharm_el_sheikh: { lat: 27.9158, lon: 34.3300 },
  dahab: { lat: 28.5091, lon: 34.5136 },
  marsa_alam: { lat: 25.0676, lon: 34.8790 },
  el_gouna: { lat: 27.3942, lon: 33.6783 },
  siwa_oasis: { lat: 29.2032, lon: 25.5197 },
};

export function nearestCity(lat: number, lon: number): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [city, coords] of Object.entries(EGYPT_CITIES)) {
    const d = Math.hypot(coords.lat - lat, coords.lon - lon);
    if (d < bestDist) {
      bestDist = d;
      best = city;
    }
  }
  return best;
}