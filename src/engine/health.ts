import { readdir, readFile } from "fs/promises";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const CHECKPOINT_DIR = path.join(DATA_DIR, "checkpoints");

export interface SourceHealth {
  name: string;
  enabled: boolean;
  bootstrapped: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  autoDisabled: boolean;
}

export async function getSourcesHealth(): Promise<SourceHealth[]> {
  const results: SourceHealth[] = [];
  try {
    const files = await readdir(CHECKPOINT_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(CHECKPOINT_DIR, file), "utf8");
        const data = JSON.parse(raw);
        results.push({
          name: file.replace(".json", ""),
          enabled: true,
          bootstrapped: data.bootstrapped ?? false,
          lastSuccessAt: data.lastSuccessAt ?? null,
          lastError: data.lastError ?? null,
          consecutiveFailures: data.consecutiveFailures ?? 0,
          autoDisabled: data.autoDisabled ?? false,
        });
      } catch {
        results.push({
          name: file.replace(".json", ""),
          enabled: true,
          bootstrapped: false,
          lastSuccessAt: null,
          lastError: "unreadable checkpoint",
          consecutiveFailures: 0,
          autoDisabled: false,
        });
      }
    }
  } catch {
    // checkpoint dir may not exist yet
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
