import { appendFile, mkdir } from "fs/promises";
import path from "path";

const LOG_PATH = path.join(process.cwd(), "data", "fetch_errors.log");

async function logError(source: string, url: string, status: number, message: string) {
  const line = `${new Date().toISOString()} [${source}] HTTP ${status} ${url} — ${message}\n`;
  try {
    await mkdir(path.dirname(LOG_PATH), { recursive: true });
    await appendFile(LOG_PATH, line);
  } catch {
    // best-effort logging, don't crash the poller
  }
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  retries = 3,
  timeoutMs = 10_000,
  sourceName = "unknown"
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After")) || 2 ** attempt;
        await sleep(retryAfter * 1000);
        continue;
      }

      if (res.status >= 400 && res.status < 500) {
        // client error — don't retry (the URL or auth is wrong)
        await logError(sourceName, url, res.status, `client error, not retrying`);
        throw new Error(`HTTP ${res.status} for ${url} (client error, not retried)`);
      }

      if (!res.ok) {
        if (attempt === retries) {
          await logError(sourceName, url, res.status, `exhausted retries`);
          throw new Error(`HTTP ${res.status} for ${url} after ${retries} attempts`);
        }
        await logError(sourceName, url, res.status, `retry ${attempt}/${retries}`);
        await sleep(2 ** attempt * 500);
        continue;
      }

      return res;
    } catch (err) {
      if (attempt === retries) {
        const msg = err instanceof Error ? err.message : String(err);
        await logError(sourceName, url, 0, `failed after ${retries} retries: ${msg}`);
        throw err;
      }
      await sleep(2 ** attempt * 500);
    }
  }
  throw new Error("unreachable");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
