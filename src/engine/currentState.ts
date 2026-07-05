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
  if (!event.expiresTime) return false;
  return new Date(event.expiresTime).getTime() < Date.now();
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

  const byCity = new Map<string, RiskEvent[]>();
  for (const event of newEvents) {
    const key = event.city ?? "unknown";
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key)!.push(event);
  }

  for (const [city, events] of byCity) {
    const existing = state[city]?.events ?? [];
    const retained = existing.filter((e) => e.source !== sourceName && !isExpired(e));
    // add new events, skipping any that already exist (by source + rawRef)
    const merged = [...retained];
    for (const event of events) {
      if (!isDuplicate(retained, event)) {
        merged.push(event);
      }
    }

    state[city] = {
      updatedAt: new Date().toISOString(),
      events: merged,
      overallRisk: computeOverallRisk(merged),
    };
  }

  await writeStateAtomic(state);
  await appendToEventLog(newEvents);
}

export async function getCityState(city: string): Promise<CityState | null> {
  const state = await readState();
  return state[city] ?? null;
}

export async function getAllStates(): Promise<CurrentState> {
  return readState();
}