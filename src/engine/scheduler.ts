import cron from "node-cron";
import type { SourceAdapter } from "./models.js";
import { runSource } from "./poller.js";

export function startScheduler(sources: SourceAdapter[]) {
  for (const adapter of sources) {
    if (!adapter.enabled) continue;
    const expr = `*/${adapter.intervalMinutes} * * * *`;
    cron.schedule(expr, async () => {
      const result = await runSource(adapter);
      console.log(`[${new Date().toISOString()}] ${adapter.name}:`, result);
    });
    console.log(`Scheduled ${adapter.name} every ${adapter.intervalMinutes}min`);
  }
}

export async function runAllOnce(sources: SourceAdapter[]) {
  const results = await Promise.all(sources.map((s) => runSource(s)));
  return sources.map((s, i) => ({ source: s.name, ...results[i] }));
}