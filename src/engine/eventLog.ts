import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import type { RiskEvent, Severity, Category } from "./models.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const LOG_PATH = path.join(DATA_DIR, "event_log.json");
const MAX_ENTRIES = 1000;

export interface LogEntry {
  loggedAt: string;
  source: string;
  city: string | null;
  severity: Severity;
  category: Category;
  headline: string;
  rawRef: string;
}

async function readLog(): Promise<LogEntry[]> {
  try {
    return JSON.parse(await readFile(LOG_PATH, "utf8"));
  } catch {
    return [];
  }
}

export async function appendToEventLog(events: RiskEvent[]) {
  if (events.length === 0) return;
  const entries: LogEntry[] = events.map((e) => ({
    loggedAt: new Date().toISOString(),
    source: e.source,
    city: e.city,
    severity: e.severity,
    category: e.category,
    headline: e.headline,
    rawRef: e.rawRef,
  }));

  const existing = await readLog();
  const merged = [...entries, ...existing].slice(0, MAX_ENTRIES);

  await mkdir(path.dirname(LOG_PATH), { recursive: true });
  await writeFile(LOG_PATH, JSON.stringify(merged, null, 2));
}

export async function getChangesSince(
  since: string,
  city?: string,
): Promise<LogEntry[]> {
  const sinceMs = new Date(since).getTime();
  if (isNaN(sinceMs)) return [];

  const log = await readLog();
  return log.filter((e) => {
    if (new Date(e.loggedAt).getTime() <= sinceMs) return false;
    if (city && e.city !== city) return false;
    return true;
  });
}
