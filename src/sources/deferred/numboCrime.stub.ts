import { readFile } from "fs/promises";
import path from "path";
import type { RiskEvent } from "../../engine/models.js";

const STATIC_PATH = path.join(process.cwd(), "data", "static_safety_notes.json");

// Not a real SourceAdapter — Numbeo API is paid and not wired for MVP.
// This reads the manually curated static notes instead, on-demand (not scheduled).
export async function getStaticCrimeNotes(): Promise<Record<string, RiskEvent>> {
  const raw = JSON.parse(await readFile(STATIC_PATH, "utf8"));
  const out: Record<string, RiskEvent> = {};
  for (const [city, entry] of Object.entries(raw as any)) {
    out[city] = {
      source: "static_safety_notes",
      category: "crime",
      severity: (entry as any).level,
      city,
      lat: 0,
      lon: 0,
      headline: (entry as any).note,
      effectiveTime: new Date().toISOString(),
      rawRef: "manual-curation",
    };
  }
  return out;
}