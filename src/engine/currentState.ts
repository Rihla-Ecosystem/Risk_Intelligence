import { readFile, writeFile, rename, mkdir } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import type { RiskEvent, Severity } from "./models.js";
import { appendToEventLog } from "./eventLog.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const STATE_PATH = path.join(DATA_DIR, "current_state.json");
const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  advisory: 1,
  warning: 2,
  critical: 3,
};

interface CityState {
  updatedAt: string;
  events: RiskEvent[];
  overallRisk: Severity;
}

type CurrentState = Record<string, CityState>;

async function readState(): Promise<CurrentState> {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function writeStateAtomic(state: CurrentState) {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  const tmp = `${STATE_PATH}.tmp-${randomUUID()}`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, STATE_PATH);
}

function isExpired(event: RiskEvent): boolean {
  if (event.expiresTime) {
    return new Date(event.expiresTime).getTime() < Date.now();
  }
  const effective = event.effectiveTime ? new Date(event.effectiveTime).getTime() : 0;
  if (!effective) return true;
  let ttl = 24 * 60 * 60 * 1000;
  if (event.source === "openweather_current" || event.source === "openweather_air") {
    ttl = 2 * 60 * 60 * 1000;
  } else if (event.category === "health") {
    ttl = 7 * 24 * 60 * 60 * 1000;
  } else if (event.category === "unrest" || event.category === "advisory") {
    ttl = 48 * 60 * 60 * 1000;
  }
  return effective + ttl < Date.now();
}

function computeOverallRisk(events: RiskEvent[]): Severity {
  let max: Severity = "info";
  for (const e of events) {
    if (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max]) max = e.severity;
  }
  return max;
}

function eventKey(event: RiskEvent): string {
  return `${event.source}::${event.rawRef}`;
}

function isDuplicate(existing: RiskEvent[], candidate: RiskEvent): boolean {
  return existing.some((e) => eventKey(e) === eventKey(candidate));
}

export async function mergeIntoCurrentState(sourceName: string, newEvents: RiskEvent[]) {
  const state = await readState();

  for (const event of newEvents) {
    if (!event.expiresTime) {
      let ttl = 24 * 60 * 60 * 1000;
      if (event.source === "openweather_current" || event.source === "openweather_air") {
        ttl = 2 * 60 * 60 * 1000;
      } else if (event.category === "health") {
        ttl = 7 * 24 * 60 * 60 * 1000;
      } else if (event.category === "unrest" || event.category === "advisory") {
        ttl = 48 * 60 * 60 * 1000;
      }
      event.expiresTime = new Date(Date.now() + ttl).toISOString();
    }
  }

  const byCity = new Map<string, RiskEvent[]>();
  for (const event of newEvents) {
    const key = event.city ?? "unknown";
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key)!.push(event);
  }

  const allCities = new Set([...Object.keys(state), ...byCity.keys()]);

  for (const city of allCities) {
    const existing = state[city]?.events ?? [];
    const retained = existing.filter((e) => e.source !== sourceName && !isExpired(e));
    const newCityEvents = byCity.get(city) ?? [];
    const merged = [...retained];

    for (const event of newCityEvents) {
      if (!isDuplicate(retained, event)) {
        merged.push(event);
      }
    }

    const activeList = merged.filter((e) => !isExpired(e));

    state[city] = {
      updatedAt: new Date().toISOString(),
      events: activeList,
      overallRisk: computeOverallRisk(activeList),
    };
  }

  await writeStateAtomic(state);
  await appendToEventLog(newEvents);
}

export async function getCityState(city: string): Promise<CityState | null> {
  const state = await readState();
  const cityState = state[city];
  if (!cityState) return null;
  const activeList = cityState.events.filter((e) => !isExpired(e));
  return {
    ...cityState,
    events: activeList,
    overallRisk: computeOverallRisk(activeList),
  };
}

export async function getAllStates(): Promise<CurrentState> {
  const state = await readState();
  const cleaned: CurrentState = {};
  for (const [city, cityState] of Object.entries(state)) {
    const activeList = cityState.events.filter((e) => !isExpired(e));
    cleaned[city] = {
      ...cityState,
      events: activeList,
      overallRisk: computeOverallRisk(activeList),
    };
  }
  return cleaned;
}