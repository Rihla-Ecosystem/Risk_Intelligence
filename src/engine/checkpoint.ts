import { readFile, writeFile, rename, mkdir, open, unlink } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import type { Checkpoint } from "./models.js";

const BASE_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DATA_DIR = path.join(BASE_DIR, "checkpoints");

function paths(sourceName: string) {
  return {
    checkpoint: path.join(DATA_DIR, `${sourceName}.json`),
    lock: path.join(DATA_DIR, `${sourceName}.lock`),
  };
}

export async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
  // clean stale locks from previous runs — no concurrent process on single-instance
  const { readdir } = await import("fs/promises");
  const files = await readdir(DATA_DIR);
  for (const f of files) {
    if (f.endsWith(".lock")) {
      await unlink(path.join(DATA_DIR, f)).catch(() => {});
    }
  }
}

export async function readCheckpoint(sourceName: string): Promise<Checkpoint> {
  const { checkpoint } = paths(sourceName);
  try {
    return JSON.parse(await readFile(checkpoint, "utf8"));
  } catch {
    return { lastUpdateTime: null, lastSuccessAt: null, lastError: null, bootstrapped: false };
  }
}

export async function writeCheckpointAtomic(sourceName: string, next: object) {
  const { checkpoint } = paths(sourceName);
  const tmp = `${checkpoint}.tmp-${randomUUID()}`;
  await writeFile(tmp, JSON.stringify(next, null, 2));
  await rename(tmp, checkpoint); // atomic on same filesystem
}

const STALE_MULTIPLIER = 2;

export async function acquireLock(sourceName: string, intervalMinutes: number): Promise<boolean> {
  const { lock } = paths(sourceName);
  try {
    const fh = await open(lock, "wx");
    await fh.writeFile(JSON.stringify({ startedAt: Date.now() }));
    await fh.close();
    return true;
  } catch (err: any) {
    if (err.code !== "EEXIST") throw err;
    const raw = await readFile(lock, "utf8").catch(() => null);
    if (!raw) return acquireLock(sourceName, intervalMinutes);
    const { startedAt } = JSON.parse(raw);
    const staleAfterMs = intervalMinutes * 60_000 * STALE_MULTIPLIER;
    if (Date.now() - startedAt > staleAfterMs) {
      await releaseLock(sourceName);
      return acquireLock(sourceName, intervalMinutes);
    }
    return false;
  }
}

export async function releaseLock(sourceName: string) {
  const { lock } = paths(sourceName);
  await unlink(lock).catch(() => {});
}