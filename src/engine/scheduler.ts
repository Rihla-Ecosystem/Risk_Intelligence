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
  // First pass: run all in parallel
  const settled = await Promise.allSettled(
    sources.map(async (s) => {
      const r = await runSource(s);
      return { source: s.name, ...r };
    })
  );

  const results: Array<{ source: string; status: "OK" | "SKIPPED" | "FAILED"; count?: number; error?: string }> =
    settled.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : { source: "unknown", status: "FAILED" as const, error: String(r.reason) }
    );

  // Second pass: retry failed sources sequentially with a small gap
  const failed = results.filter((r) => r.status === "FAILED" || (r.status === "OK" && r.count === 0));
  if (failed.length > 0) {
    console.log(`[scheduler] retry pass: ${failed.length} sources to retry`);
    for (const f of failed) {
      const adapter = sources.find((s) => s.name === f.source);
      if (!adapter) continue;
      await sleep(2_000); // stagger retries 2s apart
      const retry = await runSource(adapter);
      const idx = results.findIndex((r) => r.source === f.source);
      if (idx !== -1) results[idx] = { source: f.source, ...retry };
    }
  }

  return results;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}