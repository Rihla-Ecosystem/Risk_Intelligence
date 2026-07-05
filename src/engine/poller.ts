import type { SourceAdapter, RiskEvent } from "./models.js";
import { readCheckpoint, writeCheckpointAtomic, acquireLock, releaseLock } from "./checkpoint.js";
import { fetchWithRetry } from "./httpClient.js";
import { mergeIntoCurrentState } from "./currentState.js";

const MAX_CONSECUTIVE_FAILURES = 5;

export async function runSource(adapter: SourceAdapter): Promise<
  { status: "OK"; count: number } | { status: "SKIPPED" | "FAILED"; error?: string }
> {
  if (!adapter.enabled) return { status: "SKIPPED" };

  const gotLock = await acquireLock(adapter.name, adapter.intervalMinutes);
  if (!gotLock) return { status: "SKIPPED" };

  try {
    const checkpoint = await readCheckpoint(adapter.name);

    // auto-disable after too many consecutive failures
    const failures: number = (checkpoint.consecutiveFailures as number) ?? 0;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      await writeCheckpointAtomic(adapter.name, { ...checkpoint, autoDisabled: true, lastError: `disabled after ${failures} consecutive failures` });
      return { status: "FAILED", error: `auto-disabled after ${failures} consecutive failures` };
    }

    let raw: unknown;
    let events: RiskEvent[];

    if (adapter.fetchData) {
      const result = await adapter.fetchData(checkpoint);
      raw = result.raw;
      events = result.events;
    } else {
      const { url, init } = adapter.buildRequest(checkpoint);
      const res = await fetchWithRetry(url, init, 3, 10_000, adapter.name);

      const contentType = res.headers.get("content-type") ?? "";
      raw = contentType.includes("json") ? await res.json() : await res.text();

      events = adapter.parse(raw, checkpoint);
    }

    const nextCheckpoint = adapter.nextCheckpoint(raw, events, checkpoint);

    await writeCheckpointAtomic(adapter.name, {
      ...nextCheckpoint,
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      bootstrapped: true,
      consecutiveFailures: 0,
      autoDisabled: false,
    });

    await mergeIntoCurrentState(adapter.name, events);
    return { status: "OK", count: events.length };
  } catch (err: any) {
    const checkpoint = await readCheckpoint(adapter.name);
    const failures: number = (checkpoint.consecutiveFailures as number) ?? 0;
    await writeCheckpointAtomic(adapter.name, {
      ...checkpoint,
      lastError: String(err),
      consecutiveFailures: failures + 1,
    });
    return { status: "FAILED", error: String(err) };
  } finally {
    await releaseLock(adapter.name);
  }
}
