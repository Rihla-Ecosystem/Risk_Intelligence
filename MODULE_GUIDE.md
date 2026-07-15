# Risk Intelligence Module — Complete Developer Guide

> **Audience:** New developers onboarding to the module.  
> **Goal:** After reading this document you should be able to run the module, add a new data source, debug a failing adapter, and understand every file's purpose — without opening any other file first.

---

## Table of Contents

1. [Module Overview & Purpose](#1-module-overview--purpose)  
2. [High-Level Architecture Diagram](#2-high-level-architecture-diagram)  
3. [Project Structure](#3-project-structure)  
4. [Responsibilities of Every File & Folder](#4-responsibilities-of-every-file--folder)  
5. [Core Concepts](#5-core-concepts)  
6. [Complete Data Flow](#6-complete-data-flow)  
7. [API Reference & Routes](#7-api-reference--routes)  
8. [Scheduler / Cron Flow](#8-scheduler--cron-flow)  
9. [Source Adapters — How They Work](#9-source-adapters--how-they-work)  
10. [Severity Classification Engine](#10-severity-classification-engine)  
11. [Database / File-Based State](#11-database--file-based-state)  
12. [External Integrations](#12-external-integrations)  
13. [Environment Variables & Configuration](#13-environment-variables--configuration)  
14. [Quick-Start Guide](#14-quick-start-guide)  
15. [Adding a New Data Source](#15-adding-a-new-data-source)  
16. [Common Debugging Scenarios](#16-common-debugging-scenarios)  
17. [Known Limitations & Potential Issues](#17-known-limitations--potential-issues)  

---

## 1. Module Overview & Purpose

The **Risk Intelligence** module is a **background polling engine** that continuously aggregates safety and risk data from up to 15 free external sources and presents a single, unified JSON risk picture for every Egyptian city.

It is part of the **Rihla** system — an AI tour-guide platform. When a tourist asks *"Is it safe in Luxor right now?"*, the Rihla agent calls this module's API and gets a pre-classified, pre-merged answer instead of having to query 15 different APIs itself.

### Design Philosophy (why it was built this way)

| Constraint | Decision | Rationale |
|---|---|---|
| Zero cost | No LLM, no paid API, no database | The module must run indefinitely for free |
| Single-instance | File-based state; atomic writes | Avoids the complexity of a distributed store for a single-server deployment |
| Predictable output | Deterministic rule-based severity | An LLM could classify the same text differently every call; keyword rules are consistent and free |
| Easy extension | Generic `SourceAdapter` interface | Adding a new source = one ~30-line file; no changes to the engine |

### What the module is NOT

- It is **not** a proxy — it never returns raw external API responses.  
- It is **not** an AI model — all classification is pure rule-based logic.  
- It is **not** designed for horizontal scaling — the file lock system is single-process by design.

---

## 2. High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SOURCES (15)                          │
│  USGS · EMSC · NOAA · GDELT · ReliefWeb · State Dept · FCDO            │
│  WHO · CDC · OpenWeather · OpenWeather Air · NASA FIRMS · ACLED · GloFAS│
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ HTTP/RSS/CSV (polled by node-cron)
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  SCHEDULER  (src/engine/scheduler.ts)                                   │
│  One cron job per adapter   e.g. */15 * * * * for usgs_earthquake       │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ calls runSource() per tick
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  POLLER  (src/engine/poller.ts)                              per source  │
│  1. acquireLock  → skip if already running                              │
│  2. readCheckpoint  → know what was last seen                           │
│  3. fetchData OR buildRequest→fetch→parse                               │
│  4. mergeIntoCurrentState                                               │
│  5. writeCheckpointAtomic (success/failure counters)                    │
│  6. releaseLock                                                         │
└────────────┬─────────────────────────────┬──────────────────────────────┘
             │                             │
             ▼                             ▼
┌────────────────────────┐   ┌─────────────────────────────────┐
│  SEVERITY CLASSIFIER   │   │  HTTP CLIENT  (httpClient.ts)   │
│  (severity/rules.ts)   │   │  Retry + timeout + error log    │
│  7 deterministic funcs │   │  4xx → no retry, 429 → backoff  │
└────────────┬───────────┘   └─────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  FILE-BASED STATE                                                        │
│  data/current_state.json   ← per-city event list + overallRisk          │
│  data/event_log.json       ← append-only log, capped at 1000 entries    │
│  data/checkpoints/*.json   ← per-source health + cursor                 │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ read by Fastify handlers
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  HTTP API (Fastify, port 3000)                                           │
│  GET  /                              → Dashboard HTML                   │
│  GET  /safety/current?city=cairo     → Merged risk state (with notes)   │
│  GET  /safety/changes?since=ISO      → Delta events since timestamp     │
│  GET  /safety/health                 → Per-source health report         │
│  POST /safety/refresh?source=name    → Ad-hoc re-poll                   │
│  Optional: X-API-Key header (AUTH_TOKEN env var)                        │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           │  consumed by
                           ▼
                ┌──────────────────────┐
                │  Rihla Agent / Dash  │
                │  Notification Svc    │
                └──────────────────────┘
```

---

## 3. Project Structure

```
risk-intelligence/
├── config/
│   └── sources.yaml              # Master enable/interval/auth registry
│
├── data/                         # Runtime state (created automatically)
│   ├── current_state.json        # Merged risk state per city
│   ├── event_log.json            # Change log, last 1000 entries
│   ├── fetch_errors.log          # HTTP error log (plain text, append)
│   ├── static_safety_notes.json  # Manually curated city safety notes
│   └── checkpoints/              # Per-source checkpoint + lock files
│       ├── usgs_earthquake.json
│       ├── usgs_earthquake.lock  # Exists only while source is running
│       └── ...
│
├── src/
│   ├── index.ts                  # Entry point — wires everything together
│   │
│   ├── api/
│   │   └── routes.ts             # Fastify route definitions + auth hook
│   │
│   ├── engine/                   # Core orchestration — source-agnostic
│   │   ├── models.ts             # TypeScript types + city coordinates
│   │   ├── poller.ts             # The polling loop (lock→fetch→parse→merge)
│   │   ├── scheduler.ts          # node-cron job registration
│   │   ├── checkpoint.ts         # File locks + atomic checkpoint reads/writes
│   │   ├── currentState.ts       # State read/merge/write logic
│   │   ├── eventLog.ts           # Append-only event log (powers /changes)
│   │   ├── health.ts             # Reads checkpoints → health report
│   │   └── httpClient.ts         # fetch wrapper with retry and error logging
│   │
│   ├── severity/
│   │   └── rules.ts              # 7 deterministic severity classifier functions
│   │
│   ├── sources/
│   │   ├── noAuth/               # 9 adapters that need no credentials
│   │   │   ├── usgsEarthquake.ts
│   │   │   ├── emscSeismic.ts
│   │   │   ├── noaaTsunami.ts
│   │   │   ├── gdeltUnrest.ts
│   │   │   ├── reliefweb.ts
│   │   │   ├── stateDeptAdvisory.ts
│   │   │   ├── fcdoAdvisory.ts
│   │   │   ├── whoOutbreak.ts
│   │   │   └── cdcTravelHealth.ts
│   │   │
│   │   ├── withKey/              # 5 adapters that need API keys / OAuth
│   │   │   ├── openWeather.ts    # UV + temperature (uses fetchData)
│   │   │   ├── openWeatherAir.ts # AQI per city  (uses fetchData)
│   │   │   ├── nasaFirms.ts      # Fire hotspots (CSV response)
│   │   │   ├── acledUnrest.ts    # Conflict data — disabled by default
│   │   │   └── glofasSidecar.ts  # Flood forecast — disabled (stub)
│   │   │
│   │   └── deferred/             # Paid/unavailable sources — stubs only
│   │       ├── numboCrime.stub.ts  # Reads static_safety_notes.json
│   │       └── geosureSafety.stub.ts
│   │
│   ├── sidecars/
│   │   └── glofas/               # Python subprocess files (not implemented)
│   │
│   └── __tests__/
│       └── rules.test.ts         # 30 unit tests for severity/rules.ts
│
├── Dockerfile                    # Multi-stage build (Node 22 + Python 3 alpine)
├── tsconfig.json
├── package.json
└── .env.example
```

---

## 4. Responsibilities of Every File & Folder

### `src/index.ts` — Application entry point

**What it does:**
1. Loads environment variables (`dotenv/config`).
2. Calls `ensureDataDir()` — creates `data/checkpoints/` and clears stale lock files from a previous crash.
3. Reads `config/sources.yaml` and overlays enabled/interval overrides onto each adapter object.
4. Calls `startScheduler(activeAdapters)` — registers one cron job per source.
5. Creates a Fastify server, registers routes, and listens on `PORT` (default `3000`).

**Why:** Separating bootstrap from business logic means you can import adapters independently (e.g., in tests) without starting the HTTP server.

---

### `config/sources.yaml` — Source registry

The single place where operations teams can enable/disable sources and change poll intervals **without touching TypeScript code**. Each entry has:

```yaml
- name: usgs_earthquake   # must match adapter.name exactly
  enabled: true           # false = adapter never runs
  intervalMinutes: 15
  auth: none              # informational only — actual auth lives in the adapter
  secretEnv: OPENWEATHER_API_KEY  # informational only — which env var to set
```

`index.ts` reads this file and merges `enabled` and `intervalMinutes` over the adapter's hardcoded defaults. This means **the YAML is the source of truth** for scheduling; adapter defaults are only fallbacks.

---

### `src/engine/models.ts` — TypeScript types + city coordinates

Defines the contracts every other file depends on:

- **`Severity`** — `"info" | "advisory" | "warning" | "critical"` (ordered least → most severe)
- **`Category`** — `"seismic" | "weather" | "fire" | "flood" | "unrest" | "health" | "crime" | "advisory" | "tsunami"`
- **`RiskEvent`** — the fundamental unit of data in the system (one risk observation for one place at one time)
- **`Checkpoint`** — per-source state persisted to disk between polls (cursor + health counters)
- **`SourceAdapter`** — the interface every source adapter must implement
- **`EGYPT_CITIES`** — hardcoded lat/lon for all 11 monitored cities
- **`nearestCity(lat, lon)`** — utility function that maps any lat/lon to the nearest monitored city using Euclidean distance

**Why `nearestCity` instead of geofencing?** Simple, zero-dependency approach. Euclidean distance in degree-space is slightly inaccurate at scale but perfectly adequate for Egypt's geographic spread.

---

### `src/engine/poller.ts` — The polling loop

`runSource(adapter)` is the core function that every adapter goes through. Here is what happens step by step:

```
1. adapter.enabled? No → return SKIPPED
2. acquireLock(name, interval)
   → Lock already exists and NOT stale → return SKIPPED (previous poll still running)
   → Lock stale (> 2× interval old) → delete stale lock, acquire fresh
3. readCheckpoint(name)  ← gives the adapter its cursor
4. Check consecutiveFailures in checkpoint
   → ≥ 5 → mark autoDisabled, return FAILED
5. Has adapter.fetchData?
   → YES: call adapter.fetchData(checkpoint)  [multi-fetch or subprocess path]
   → NO:  call adapter.buildRequest(checkpoint) → fetchWithRetry → parse
6. mergeIntoCurrentState(name, events)
7. writeCheckpointAtomic with lastSuccessAt, consecutiveFailures=0
8. return OK + event count
On any exception:
   → readCheckpoint, increment consecutiveFailures, writeCheckpoint, return FAILED
finally:
   → releaseLock (always)
```

**Why file locks instead of in-memory?** A crash leaves a lock file behind. On restart, `ensureDataDir()` clears all `.lock` files. A pure in-memory semaphore would disappear on crash, allowing two overlapping polls on restart.

---

### `src/engine/scheduler.ts` — Cron registration

`startScheduler(adapters)`:
- For each enabled adapter, creates a `node-cron` job using the expression `*/{intervalMinutes} * * * *`
- Each cron tick calls `runSource(adapter)` and logs the result

`runAllOnce(adapters)`:
- Used by `POST /safety/refresh` — runs all adapters in parallel, then retries any that returned 0 events or FAILED (sequentially, 2s apart)
- Returns a summary array

**Why separate `runAllOnce` from the scheduler?** The HTTP refresh endpoint needs a result to return to the caller. The cron jobs fire-and-forget. Having two distinct functions keeps the concerns separate.

---

### `src/engine/checkpoint.ts` — File-based state per source

Each source gets two files in `data/checkpoints/`:

| File | Purpose |
|------|---------|
| `{name}.json` | Source cursor + health counters (last success, last error, consecutive failures) |
| `{name}.lock` | Existence = source is currently running; written at poll start, deleted at poll end |

Key functions:

- **`writeCheckpointAtomic`** — writes to a temp file with a UUID suffix, then renames it. Rename is atomic on POSIX (and effectively atomic on Windows NTFS). This prevents partial reads if the process crashes mid-write.
- **`acquireLock`** — uses `open(lock, 'wx')` which fails with `EEXIST` if file exists (atomic exclusive create). If lock exists and is older than `2 × intervalMinutes`, it is considered stale from a previous crash.

---

### `src/engine/currentState.ts` — State aggregation

The most important business-logic file. `mergeIntoCurrentState(sourceName, newEvents)`:

1. Reads `data/current_state.json` (or starts empty)
2. Groups `newEvents` by city
3. For each city:
   - Takes existing events, **removes all events from this source** (so old events from the same source don't accumulate across polls)  
   - Also removes any events where `expiresTime` has passed
   - Adds the new events, **skipping duplicates** (matched by `source + rawRef`)
   - Recomputes `overallRisk` = max severity across all retained events
4. Writes back atomically
5. Calls `appendToEventLog(newEvents)` — all new events are independently logged

**Why remove the source's old events on each poll?** This implements "last write wins" per source. If USGS returned 3 earthquakes last poll and returns 1 earthquake this poll, the state should reflect just the 1 current earthquake, not accumulate to 4.

**Why keep events from other sources?** Each source polls independently. Removing USGS events doesn't affect OpenWeather events — they co-exist in the same city's event list.

---

### `src/engine/eventLog.ts` — Append-only change log

`appendToEventLog(events)`:
- Reads current log (or starts with `[]`)
- Prepends new entries (newest first)
- Slices to `MAX_ENTRIES = 1000`
- Overwrites `data/event_log.json`

`getChangesSince(since, city?)`:
- Filters log entries where `loggedAt > since`
- Optionally filters by city
- Powers `GET /safety/changes`

**Why cap at 1000?** The file lives on disk across restarts. Without a cap it would grow unboundedly. 1000 entries at ~200 bytes each ≈ 200 KB — trivial. If the agent polls every 5 minutes, 1000 entries covers ~3.5 days of history at normal event volumes.

**LogEntry vs RiskEvent:** `LogEntry` is a leaner projection of `RiskEvent` — it drops `lat`, `lon`, `detail`, and `expiresTime` (not needed for change-tracking) and adds `loggedAt`.

---

### `src/engine/health.ts` — Source health inspector

Reads all `data/checkpoints/*.json` files and returns a structured health report per source. It does **not** know which adapters are registered — it just reads every checkpoint file it finds. This means a source that has never run (no checkpoint file) won't appear in the health report.

**Why read from disk, not from in-memory state?** The health endpoint needs to survive a server restart. If health were in-memory, all sources would appear "never run" after a restart even if they had successfully polled for weeks.

---

### `src/engine/httpClient.ts` — Resilient HTTP wrapper

`fetchWithRetry(url, init, retries, timeoutMs, sourceName)`:

| Status | Behavior |
|--------|---------|
| `200–399` | Return response |
| `429` | Wait for `Retry-After` header (or exponential backoff `2^attempt` seconds), retry |
| `400–499` (except 429) | Throw immediately — no retry (misconfigured URL/auth) |
| `500+` | Retry with exponential backoff (`500ms × 2^attempt`) |
| Timeout / network error | Retry with exponential backoff |

All failures are appended to `data/fetch_errors.log` (non-blocking — a logging failure never crashes the poller).

**Why no retry on 4xx?** A 404 or 403 won't fix itself by retrying. Retrying wastes quota and pollutes the error log. The poller's `consecutiveFailures` counter will eventually auto-disable the source so an ops alert fires.

---

### `src/severity/rules.ts` — Classification engine

Seven pure functions, all with the same signature: take a numeric or string input, return `Severity`.

| Function | Input | Example |
|----------|-------|---------|
| `earthquakeSeverity(mag)` | USGS magnitude | `earthquakeSeverity(5.2) → "warning"` |
| `uvIndexSeverity(uv)` | OpenWeather UV index | `uvIndexSeverity(11) → "critical"` |
| `tempSeverity(°C)` | OpenWeather temperature | `tempSeverity(42) → "warning"` |
| `aqiSeverity(aqi)` | OpenWeather AQI 1–5 | `aqiSeverity(5) → "critical"` |
| `fireConfidenceSeverity(conf%, frp)` | NASA FIRMS | `fireConfidenceSeverity(85, 60) → "critical"` |
| `advisoryLevelSeverity(level)` | US State Dept level 1–4 | `advisoryLevelSeverity(3) → "warning"` |
| `textSeverityClassifier(text)` | Any free-text headline | `textSeverityClassifier("outbreak in Cairo") → "warning"` |

`textSeverityClassifier` uses a three-tier keyword cascade (evaluated top-to-bottom; first match wins):
```
critical  → death, fatal, kill, emergency, evacuate
warning   → outbreak, casualt, injured, warning, severe, pandemic
advisory  → risk, unrest, protest, clash, advisory, caution, threat
info      → (default — no keywords matched)
```

Note `"casualt"` (not `"casualty"`) — this is a deliberate partial match that catches both *casualty* and *casualties*.

---

### `src/api/routes.ts` — HTTP layer

Registers five routes on the Fastify instance:

| Route | Handler |
|-------|---------|
| `GET /` | Serve `src/public/dashboard.html` |
| `GET /safety/current` | Read `current_state.json` + static notes |
| `GET /safety/changes` | Query `event_log.json` |
| `GET /safety/health` | Read all checkpoint files |
| `POST /safety/refresh` | Trigger immediate poll of one or all sources |

**Auth hook:** `app.addHook("preHandler", authHook)` runs before every route. If `AUTH_TOKEN` env var is set, the hook checks `X-API-Key` header. If missing/wrong, returns 401. If `AUTH_TOKEN` is not set, the hook is a no-op (open access).

**Note:** `/` (dashboard) is registered *before* `addHook`, so the dashboard itself is always accessible even with auth enabled. This is intentional — the dashboard renders public data.

**Static notes integration:** `GET /safety/current?city=X` reads `data/static_safety_notes.json` via `getStaticCrimeNotes()` and attaches the note as `staticNote` in the response. This happens at query-time, not at poll-time — static notes are never part of the scheduled event flow.

---

### `src/sources/noAuth/` — 9 credentials-free adapters

| File | Source | Data type | Interval |
|------|--------|-----------|----------|
| `usgsEarthquake.ts` | USGS Earthquake Hazards | GeoJSON feature collection | 15 min |
| `emscSeismic.ts` | European Mediterranean Seismological Centre | GeoJSON | 15 min |
| `noaaTsunami.ts` | NOAA weather alerts | JSON alerts | 60 min |
| `gdeltUnrest.ts` | GDELT Doc 2.0 API | JSON article list | 20 min |
| `reliefweb.ts` | ReliefWeb reports V2 | JSON reports | 360 min |
| `stateDeptAdvisory.ts` | US State Dept travel.state.gov | HTML scrape | 720 min |
| `fcdoAdvisory.ts` | UK FCDO | JSON content API | 720 min |
| `whoOutbreak.ts` | WHO Disease Outbreak News | OData JSON | 720 min |
| `cdcTravelHealth.ts` | CDC Travel Health Notices | RSS/XML | 720 min |

---

### `src/sources/withKey/` — 5 API-key adapters

| File | Auth mechanism | Notes |
|------|---------------|-------|
| `openWeather.ts` | `OPENWEATHER_API_KEY` in query string | Uses `fetchData` — loops over 11 cities serially |
| `openWeatherAir.ts` | `OPENWEATHER_API_KEY` in query string | Uses `fetchData` — air pollution API per city |
| `nasaFirms.ts` | `FIRMS_MAP_KEY` in URL path | Returns CSV, parsed manually — no JSON parser needed |
| `acledUnrest.ts` | OAuth 2.0 (email/password → access token, stored in checkpoint) | `enabled: false` in sources.yaml |
| `glofasSidecar.ts` | `CDS_API_KEY` env for Python subprocess | `enabled: false` — GRIB parsing not implemented |

---

### `src/sources/deferred/` — Stubs for paid/unavailable sources

- **`numboCrime.stub.ts`** — Not a `SourceAdapter`. Exports `getStaticCrimeNotes()` which reads `data/static_safety_notes.json`. Called by `routes.ts` at query time. The real Numbeo API requires payment.
- **`geosureSafety.stub.ts`** — Complete stub, not currently wired anywhere.

---

### `src/sidecars/glofas/` — Python flood data sidecar

Contains the Python script that would download GRIB-format river flood data from Copernicus CDS and output JSON on stdout. `glofasSidecar.ts` captures stdout with `execFile`. The Python script is **not yet implemented** — the sidecar adapter is disabled.

---

### `data/static_safety_notes.json` — Manually curated city notes

A JSON file mapping city keys to `{ note: string; level: Severity }`. Provides crime/safety context that no free real-time API covers. Served as `staticNote` on every `GET /safety/current?city=X` response.

---

## 5. Core Concepts

### The `SourceAdapter` Interface

Every data source is one TypeScript object matching this interface:

```typescript
interface SourceAdapter {
  name: string;
  intervalMinutes: number;
  enabled: boolean;
  timeoutMs?: number;

  // Standard path: build one URL, fetch it, parse the response
  buildRequest(checkpoint: Checkpoint): { url: string; init?: RequestInit };
  parse(raw: unknown, checkpoint: Checkpoint): RiskEvent[];
  nextCheckpoint(raw: unknown, events: RiskEvent[], prev: Checkpoint): Checkpoint;

  // Optional escape hatch: manage fetching yourself (multi-city, subprocess, etc.)
  fetchData?(checkpoint: Checkpoint): Promise<{ raw: unknown; events: RiskEvent[] }>;
}
```

**Standard path (e.g., `usgsEarthquake`):**
1. `buildRequest` returns a URL (and optionally `RequestInit` headers).  
2. The poller fetches it, auto-detects JSON or text, calls `parse`.  
3. `nextCheckpoint` extracts a cursor from the raw response (e.g., the latest event timestamp).

**`fetchData` escape hatch (e.g., `openWeather`, `acledUnrest`):**
- Called instead of `buildRequest` + fetch + `parse`.
- The adapter manages its own HTTP calls (useful for looping over 11 cities or handling OAuth).
- Must return `{ raw, events }` — raw is passed to `nextCheckpoint` for cursor extraction.

### The `Checkpoint`

A plain JSON object stored at `data/checkpoints/{name}.json`. The base interface is:

```typescript
interface Checkpoint {
  lastUpdateTime: string | null;  // cursor: don't re-fetch events before this
  lastSuccessAt: string | null;   // last time the poll succeeded
  lastError: string | null;       // last error message
  bootstrapped: boolean;          // has this source ever succeeded?
  [key: string]: unknown;         // adapters can store extra keys (e.g., seenIds, acledToken)
}
```

**Open-ended index signature** (`[key: string]: unknown`) lets adapters add custom fields without changing the base type. For example:
- `usgsEarthquake` stores nothing extra.
- `whoOutbreak` stores `seenIds: string[]` — IDs of articles already ingested.
- `acledUnrest` stores `acledToken: { accessToken, refreshToken, expiresAt }`.

### Dedup Strategy

Events are deduplicated by `source + rawRef`. The `rawRef` field is a unique identifier for the event coming from the source itself (e.g., a USGS URL, an ACLED event ID, a WHO article path). Using the source's own identifier prevents re-processing the same event across polls.

---

## 6. Complete Data Flow

### Scheduled Poll (most common path)

```
node-cron fires: */15 * * * * (for usgs_earthquake)
  │
  └─► runSource(usgsEarthquake)
        │
        ├── adapter.enabled? → true, continue
        │
        ├── acquireLock("usgs_earthquake", 15)
        │   ├── Creates data/checkpoints/usgs_earthquake.lock
        │   └── If lock exists and not stale → return SKIPPED
        │
        ├── readCheckpoint("usgs_earthquake")
        │   └── Returns { lastUpdateTime: "2026-07-13T07:00:00Z", lastSuccessAt: ..., bootstrapped: true, ... }
        │
        ├── consecutiveFailures < 5 → continue
        │
        ├── adapter.fetchData? → not defined → use standard path
        │   ├── adapter.buildRequest(checkpoint)
        │   │   └── Returns URL with starttime=lastUpdateTime, minmagnitude=3, bbox=Egypt
        │   │
        │   ├── fetchWithRetry(url, ..., 3 retries, 10s timeout)
        │   │   └── GET https://earthquake.usgs.gov/fdsnws/event/1/query?...
        │   │       Response: GeoJSON FeatureCollection
        │   │
        │   └── res.headers["content-type"].includes("json") → yes
        │       raw = await res.json()
        │
        ├── adapter.parse(raw, checkpoint)
        │   ├── Iterates raw.features[]
        │   ├── For each: earthquakeSeverity(f.properties.mag) → Severity
        │   ├── nearestCity(lat, lon) → "cairo" | "aswan" | ...
        │   └── Returns RiskEvent[]
        │
        ├── adapter.nextCheckpoint(raw, events, prev)
        │   └── Returns { ...prev, lastUpdateTime: raw.metadata.generated }
        │
        ├── mergeIntoCurrentState("usgs_earthquake", events)
        │   ├── readState() → current_state.json
        │   ├── Group events by city
        │   ├── Per city: remove old usgs_earthquake events, add new (dedup)
        │   ├── Recompute overallRisk = max(severity)
        │   ├── writeStateAtomic() → tmp file → rename to current_state.json
        │   └── appendToEventLog(events) → prepend to event_log.json, cap at 1000
        │
        ├── writeCheckpointAtomic("usgs_earthquake", { ...nextCheckpoint, lastSuccessAt: now, consecutiveFailures: 0 })
        │
        └── releaseLock("usgs_earthquake") → deletes .lock file
```

### API Request: `GET /safety/current?city=cairo`

```
HTTP GET /safety/current?city=cairo
  │
  ├── authHook: AUTH_TOKEN set? → check X-API-Key header
  │
  ├── getCityState("cairo")
  │   └── readFile(data/current_state.json) → state["cairo"]
  │       { updatedAt, events: [...], overallRisk: "advisory" }
  │
  ├── getStaticCrimeNotes()
  │   └── readFile(data/static_safety_notes.json) → { cairo: { note, level } }
  │
  └── Reply: { city, updatedAt, events, overallRisk, staticNote }
```

### API Request: `GET /safety/changes?since=2026-07-13T07:00:00Z&city=cairo`

```
HTTP GET /safety/changes?since=...&city=cairo
  │
  └── getChangesSince("2026-07-13T07:00:00Z", "cairo")
      └── readFile(data/event_log.json) → []
          filter: loggedAt > since AND city === "cairo"
          Reply: { events: [...], count: N }
```

---

## 7. API Reference & Routes

### `GET /` — Dashboard

Returns `src/public/dashboard.html`. Always accessible (auth hook is registered after this route).

---

### `GET /safety/current`

| Query param | Type | Required | Description |
|------------|------|----------|-------------|
| `city` | string | No | City key (see table below). Omit for all cities. |

**With city:** Returns `{ city, updatedAt, events[], overallRisk, staticNote }`.  
**Without city:** Returns `Record<cityKey, { updatedAt, events[], overallRisk }>`.  
**404:** If city key is unknown and has no static note.

**City keys:** `cairo`, `giza`, `alexandria`, `luxor`, `aswan`, `hurghada`, `sharm_el_sheikh`, `dahab`, `marsa_alam`, `el_gouna`, `siwa_oasis`

---

### `GET /safety/changes`

| Query param | Type | Required | Description |
|------------|------|----------|-------------|
| `since` | ISO 8601 string | **YES** | Returns events logged after this time |
| `city` | string | No | Filter by city |

**400** if `since` is missing.

---

### `GET /safety/health`

No parameters. Returns per-source health from checkpoint files:

```json
{
  "status": "ok",
  "time": "2026-07-13T08:00:00.000Z",
  "sources": [
    {
      "name": "usgs_earthquake",
      "enabled": true,
      "bootstrapped": true,
      "lastSuccessAt": "2026-07-13T07:45:00.000Z",
      "lastError": null,
      "consecutiveFailures": 0,
      "autoDisabled": false
    }
  ]
}
```

A source appears here only after its first successful or failed poll (checkpoint file must exist).

---

### `POST /safety/refresh`

| Query param | Type | Required | Description |
|------------|------|----------|-------------|
| `source` | string | No | Adapter name. Omit to refresh ALL sources. |

Triggers `runSource` (or `runAllOnce`) immediately and returns the result. Useful when you've fixed a broken API URL and want to re-poll without waiting for the next cron tick.

**Example:**
```
POST /safety/refresh?source=usgs_earthquake
→ { "source": "usgs_earthquake", "status": "OK", "count": 3 }
```

---

### Auth

Set `AUTH_TOKEN` in `.env`. All 4 safety routes then require:
```
X-API-Key: your-token-here
```

Returns `401 { "error": "unauthorized" }` on mismatch or missing header.

---

## 8. Scheduler / Cron Flow

Each enabled adapter gets exactly **one** `node-cron` job at startup. The cron expression is:

```
*/{intervalMinutes} * * * *
```

For example, `intervalMinutes: 15` → `*/15 * * * *` → fires at `:00`, `:15`, `:30`, `:45` of every hour.

**Startup behavior:**  
`node-cron` does **not** fire immediately on registration. The first poll happens at the next cron tick. This means after starting the module, you may have to wait up to `intervalMinutes` for the first data.

To get immediate data after startup, use `POST /safety/refresh`.

**Cron granularity:**  
The minimum interval is 1 minute. There is no sub-minute scheduling. Adapters with `intervalMinutes: 720` (12 hours) effectively poll twice a day.

**Overlap protection:**  
If an adapter's poll is still running when the cron fires again (e.g., a very slow external API), `acquireLock` will see the existing `.lock` file and return `SKIPPED`. This prevents concurrent overlapping polls of the same source.

---

## 9. Source Adapters — How They Work

### Standard adapter walkthrough: `usgsEarthquake`

```
buildRequest(checkpoint):
  → Uses checkpoint.lastUpdateTime as "starttime"
  → On first run (lastUpdateTime = null): starttime = 24h ago
  → Returns URL with Egypt bounding box + minmagnitude=3

parse(raw):
  → raw.features[] (GeoJSON)
  → For each: earthquakeSeverity(mag), nearestCity(lat, lon)
  → Returns RiskEvent[]

nextCheckpoint(raw, events, prev):
  → Uses raw.metadata.generated (USGS response timestamp) as new cursor
  → Next poll will only fetch events after this time
```

### `fetchData` adapter walkthrough: `openWeather`

This adapter can't use the standard single-URL path because it needs to call the API 11 times (once per city). So it implements `fetchData` directly:

```
fetchData():
  → For each of 11 EGYPT_CITIES:
      fetch weather and uvi endpoints in parallel (Promise.all)
      eventsForCity(city, data) → [UV event, Temperature event]
  → Partial failures logged but don't abort the whole batch
  → Returns { raw: {}, events: [22 events — 2 per city] }
```

Note: `buildRequest` and `parse` return empty/no-op values. The poller checks `fetchData` first.

### ACLED OAuth flow: `acledUnrest`

This is the most complex adapter. It manages OAuth 2.0 tokens persisted in the checkpoint file:

```
loadOrRenewToken(checkpoint):
  → No stored token? → fetchToken() (email/password login)
  → Token still valid (expiresAt > now + 60s)? → return as-is
  → Token expired but < 13 days old? → refreshToken() (cheaper than re-login)
  → Token > 13 days old? → fetchToken() (refresh tokens expire after 14 days)

fetchData(checkpoint):
  → loadOrRenewToken
  → GET ACLED API with Bearer token
  → raw._acledToken = token (hacky but effective — passes token to nextCheckpoint)

nextCheckpoint(raw, events, prev):
  → Extracts raw._acledToken, stores in checkpoint.acledToken
  → Token survives across restarts
```

### NASA FIRMS (CSV): `nasaFirms`

FIRMS returns CSV, not JSON. The poller detects `content-type` and passes raw text as `string` to `parse`. The adapter manually parses CSV headers, then maps rows.

---

## 10. Severity Classification Engine

All 7 functions are in `src/severity/rules.ts`. They are pure functions with no side effects.

### Numeric classifiers (thresholds)

```
earthquakeSeverity:  < 3.5 → info | ≥ 3.5 → advisory | ≥ 5.0 → warning | ≥ 6.5 → critical
uvIndexSeverity:     < 6   → info | ≥ 6   → advisory | ≥ 8   → warning | ≥ 11  → critical
tempSeverity(°C):    < 36  → info | ≥ 36  → advisory | ≥ 40  → warning | ≥ 45  → critical
aqiSeverity(1–5):   1–2   → info | 3     → advisory | 4     → warning | 5     → critical
advisoryLevelSeverity: 1  → info | 2     → advisory | 3     → warning | ≥ 4   → critical
fireConfidenceSeverity(conf%, frp):
  conf < 30%           → info
  conf ≥ 30%           → advisory
  conf ≥ 60%           → warning
  conf ≥ 80% AND frp ≥ 50 → critical   ← both criteria must be met for critical
  conf ≥ 80% AND frp < 50 → warning    ← high confidence, low fire radiative power
```

### Text classifier (keyword cascade)

```typescript
textSeverityClassifier("DEATH TOLL RISES IN CAIRO")
// Step 1: lowercase → "death toll rises in cairo"
// Step 2: check critical keywords: ["death", "fatal", "kill", "emergency", "evacuate"]
//         "death" matches → return "critical"
```

```typescript
textSeverityClassifier("Dengue outbreak reported")
// "outbreak" doesn't match critical tier
// "outbreak" matches warning tier → return "warning"
```

---

## 11. Database / File-Based State

There is **no database**. All state is stored in JSON files under `data/`:

| File | Written by | Read by |
|------|-----------|---------|
| `data/current_state.json` | `currentState.ts` (every poll merge) | `currentState.ts` (API reads), `routes.ts` |
| `data/event_log.json` | `eventLog.ts` (every poll) | `eventLog.ts` (`/changes` endpoint) |
| `data/checkpoints/{name}.json` | `checkpoint.ts` (every poll) | `checkpoint.ts`, `health.ts` |
| `data/fetch_errors.log` | `httpClient.ts` (on HTTP errors) | Human inspection only |
| `data/static_safety_notes.json` | Manual / version-controlled | `numboCrime.stub.ts` (on API query) |

### Atomic write pattern (used everywhere)

```
1. Write new content to {target}.tmp-{uuid}
2. rename({tmp}, {target})   ← atomic on same filesystem
→ Readers always see a complete file; a crash mid-write leaves the tmp file
  harmlessly (cleaned up on next write cycle)
```

### Concurrency model

Single-process only. The file lock mechanism (`acquireLock`/`releaseLock`) prevents **the same source** from polling concurrently, but does not protect against two instances of the module running simultaneously. If you need horizontal scaling, the checkpoint and state files would need to move to a shared store (Redis, Postgres, etc.) behind the same `SourceAdapter`-compatible interface.

---

## 12. External Integrations

### No-auth sources (9)

| Source | Endpoint | Response format | Egypt filter |
|--------|----------|-----------------|-------------|
| USGS Earthquake | fdsnws/event/1/query | GeoJSON | Bounding box query param |
| EMSC Seismic | fdsnws/event/1/query | GeoJSON | Radius around Egypt |
| NOAA Tsunami | api.weather.gov/alerts/active | JSON alerts | Filter in parse |
| GDELT Unrest | api.gdeltproject.org/api/v2/doc/doc | JSON articles | Query string: "Egypt AND ..." |
| ReliefWeb | api.reliefweb.int/v2/reports | JSON | Query param: country=Egypt |
| State Dept | travel.state.gov | HTML | HTML scrape: Egypt page |
| FCDO | gov.uk/api/content/foreign-travel-advice/egypt | JSON | URL-level filter |
| WHO | who.int/api/news/diseaseoutbreaknews | OData JSON | Filter in parse by keyword |
| CDC | wwwnc.cdc.gov/travel/rss/notices.xml | RSS/XML | Filter in parse |

### Key-auth sources (5)

| Source | Auth | Key env var |
|--------|------|-------------|
| OpenWeather Current | `appid` query param | `OPENWEATHER_API_KEY` |
| OpenWeather Air Pollution | `appid` query param | `OPENWEATHER_API_KEY` |
| NASA FIRMS | Key in URL path | `FIRMS_MAP_KEY` |
| ACLED | OAuth 2.0 Bearer (stored in checkpoint) | `ACLED_EMAIL`, `ACLED_PASSWORD` |
| GloFAS (disabled) | File credential (`CDS_API_KEY`) for Python | `CDS_API_KEY` |

---

## 13. Environment Variables & Configuration

All variables live in `.env` (copy from `.env.example`):

| Variable | Required for | Default | Notes |
|----------|--------------|---------|-------|
| `OPENWEATHER_API_KEY` | OpenWeather UV + temp + AQI | — | Free tier at openweathermap.org |
| `FIRMS_MAP_KEY` | NASA fire hotspots | — | Free at firms.modaps.eosdis.nasa.gov |
| `ACLED_EMAIL` | ACLED conflict data | — | Free account at acleddata.com; enable in sources.yaml |
| `ACLED_PASSWORD` | ACLED conflict data | — | Same account |
| `CDS_API_KEY` | GloFAS flood (disabled) | — | Copernicus CDS |
| `AUTH_TOKEN` | Optional API auth | (unset = open) | All `/safety/*` routes require `X-API-Key` header |
| `DATA_DIR` | Data storage path | `./data` | Override for Docker volume mounts |
| `PORT` | HTTP server port | `3000` | |

### `config/sources.yaml`

Controls which sources are active and their polling intervals at runtime:

```yaml
- name: acled_unrest
  enabled: false       # ← flip to true after registering at acleddata.com
  intervalMinutes: 60
  auth: acled_account
  secretEnv: ACLED_EMAIL
```

Changing `sources.yaml` requires a **module restart** — the yaml is read once at startup.

---

## 14. Quick-Start Guide

### 1. Prerequisites

- Node.js 22+
- Optional: Python 3 (for GloFAS sidecar — not needed unless you enable it)

### 2. Install

```bash
git clone <repo>
cd risk-intelligence
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` and add at minimum:
- `OPENWEATHER_API_KEY` — get a free key at https://openweathermap.org/api
- `FIRMS_MAP_KEY` — get a free key at https://firms.modaps.eosdis.nasa.gov/api/area/

All other keys are optional (sources will be skipped if key is missing).

### 4. Run

```bash
npm run dev       # hot-reload development mode
# OR
npm run build && npm start   # production
```

The server starts at `http://localhost:3000`. The dashboard is at `/`.

### 5. Check it's working

```bash
# After up to 20 minutes (first cron tick), or trigger a manual refresh:
curl -X POST http://localhost:3000/safety/refresh

# Then fetch Cairo's state:
curl http://localhost:3000/safety/current?city=cairo

# Or check what sources are healthy:
curl http://localhost:3000/safety/health
```

### 6. Run tests

```bash
npm test
```

30 tests, all covering `severity/rules.ts`. They run in < 1s.

### 7. Docker

```bash
docker build -t risk-intelligence .
docker run -d -p 3000:3000 \
  -e OPENWEATHER_API_KEY=your-key \
  -e FIRMS_MAP_KEY=your-key \
  -v risk-data:/app/data \
  risk-intelligence
```

The `-v risk-data:/app/data` flag persists state across container restarts.

---

## 15. Adding a New Data Source

### Step 1: Create the adapter file

```typescript
// src/sources/noAuth/mySource.ts
import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";
import { textSeverityClassifier } from "../../severity/rules.js"; // or another rule

export const mySource: SourceAdapter = {
  name: "my_source",          // must be unique; must match sources.yaml
  intervalMinutes: 60,
  enabled: true,

  buildRequest(checkpoint: Checkpoint) {
    const since = checkpoint.lastUpdateTime ?? new Date(Date.now() - 24 * 3600_000).toISOString();
    return { url: `https://api.example.com/events?since=${since}` };
  },

  parse(raw: any, _checkpoint: Checkpoint): RiskEvent[] {
    return (raw.items ?? []).map((item: any) => ({
      source: "my_source",
      category: "unrest",           // pick from Category type
      severity: textSeverityClassifier(item.title),
      city: null,                   // or nearestCity(item.lat, item.lon)
      lat: item.lat ?? 0,
      lon: item.lon ?? 0,
      headline: item.title,
      effectiveTime: item.date,
      rawRef: item.id,              // unique ID from the source — used for dedup
    }));
  },

  nextCheckpoint(raw: any, _events: RiskEvent[], prev: Checkpoint): Checkpoint {
    return { ...prev, lastUpdateTime: new Date().toISOString() };
  },
};
```

### Step 2: Register in `src/index.ts`

```typescript
import { mySource } from "./sources/noAuth/mySource.js";

const ALL_ADAPTERS: SourceAdapter[] = [
  // ... existing adapters
  mySource,
];
```

### Step 3: Add to `config/sources.yaml`

```yaml
- name: my_source
  enabled: true
  intervalMinutes: 60
  auth: none
```

### Step 4: (Optional) Add env var to `.env.example`

```env
MY_SOURCE_API_KEY=
```

### Step 5: Restart and test

```bash
npm run dev
curl -X POST "http://localhost:3000/safety/refresh?source=my_source"
```

---

## 16. Common Debugging Scenarios

### Scenario 1: Source shows 0 events but no error

**Symptoms:** `GET /safety/health` shows `bootstrapped: true`, no `lastError`, but city state has no events from this source.

**Possible causes:**
1. The source returned an empty result set (no events for Egypt in the time window). Normal behavior.
2. The parse function filtered everything out. Add a `console.log(raw)` in `parse()` and call `POST /safety/refresh?source=<name>` to inspect.
3. The adapter's `lastUpdateTime` cursor has drifted — events are filtered because they're "too old". Delete the checkpoint file and restart to reset:
   ```
   del data\checkpoints\<source-name>.json
   ```

### Scenario 2: Source is `autoDisabled`

**Symptoms:** `GET /safety/health` shows `autoDisabled: true`, `consecutiveFailures: 5`.

**Fix:**
1. Check `data/fetch_errors.log` for the HTTP error messages.
2. Fix the underlying issue (URL changed, API key expired, etc.).
3. Delete the checkpoint file to reset the failure counter:
   ```
   del data\checkpoints\<source-name>.json
   ```
4. No restart needed — next cron tick will create a fresh checkpoint.

### Scenario 3: Stale state after a crash

**Symptoms:** Events from hours ago still appear in `current_state.json` as current.

**Why it happens:** The state file is never automatically expired — each source replaces its own events on every successful poll. If a source has stopped polling (e.g., auto-disabled), its last-written events remain indefinitely.

**Fix:** Either fix and re-enable the source, or manually edit `current_state.json` to remove stale events.

### Scenario 4: ReliefWeb returns 403

**Expected** — ReliefWeb V2 requires `appname` approval. The adapter is configured but blocked until you register your app name via the ReliefWeb API form. Check `data/fetch_errors.log` for confirmation.

### Scenario 5: Changes endpoint returns empty despite new events

**Likely cause:** The `since` timestamp is too recent, or the event log has rolled over (capped at 1000).

**Check:** Read `data/event_log.json` directly and verify the `loggedAt` timestamps. The log is sorted newest-first.

### Scenario 6: Type error on startup — adapter name not found in sources.yaml

**Symptom:** Warning in console: `[scheduler] Scheduled <name> every <N>min` but the adapter isn't polling.

**Fix:** Ensure the adapter's `.name` field in TypeScript exactly matches the `name` field in `sources.yaml` (case-sensitive).

---

## 17. Known Limitations & Potential Issues

### Architectural Limitations

| Issue | Impact | Mitigation |
|-------|--------|-----------|
| **Single-instance only** | Cannot scale horizontally | File locks are process-local; second instance would corrupt state |
| **No TTL on events** | Stale events persist until source polls again | If a source auto-disables, its events stay forever |
| **Event log is not atomic** | `appendToEventLog` does a read-modify-write with no lock | Under concurrent polls to the same event log file, events could be lost. In practice, this is rare since polls are staggered, but not impossible |
| **No real-time push** | Consumers must poll `/safety/changes` | A WebSocket or SSE channel would be more efficient for real-time agents |

### Source-Specific Limitations

| Source | Limitation |
|--------|-----------|
| **ReliefWeb** | Returns HTTP 403 until `appname` is registered with ReliefWeb |
| **GDELT** | Noisy — returns news articles that mention "Egypt protest" even if the article is about something else. No geolocation on results (`city: null`). |
| **WHO / CDC** | Egypt-relevance is keyword-matched (`"egypt"`, `"cairo"`, `"nile"`, `"sinai"`). A WHO report mentioning "Upper Egypt" would not match `"egypt"` due to case, but the classifier is case-insensitive so it would match. A report titled "Nile River Basin outbreak" from Sudan would incorrectly be flagged as Egypt-relevant. |
| **ACLED** | Disabled by default; requires free account registration and OAuth setup |
| **GloFAS** | Disabled by default; Python GRIB parsing pipeline not implemented |
| **State Dept** | HTML scrape — brittle if they change their page layout |
| **OpenWeather** | API key must be on the One Call API plan for UVI endpoint (some free plans exclude it) |

### Potential Improvements

1. **Atomic event log writes:** Add a file lock (similar to checkpoint locks) around `appendToEventLog` to prevent concurrent write races.
2. **Event TTL:** Add a configurable `maxAgeDays` per category so seismic events older than 24h are automatically purged from `current_state.json`.
3. **WebSocket / SSE push:** Instead of polling `/safety/changes`, emit events over a persistent connection for real-time agent updates.
4. **Startup poll:** Call `runAllOnce` once at startup (before cron fires) so the state is populated immediately.
5. **Health includes disabled sources:** `getSourcesHealth` only reports sources with checkpoint files. Disabled sources with no files are invisible. Consider enumerating `ALL_ADAPTERS` for a complete health view.
6. **GDELT geo-tagging:** The GDELT API supports `NEAR` geo-filter — could be used to only return articles mentioning locations within Egypt's bounding box, reducing noise.
7. **`textSeverityClassifier` false positives:** The word "warning" in a weather headline ("UV warning") could inflate the severity of an unrelated text source. Consider scoping keyword lists per category.

---

## 18. Recent Stabilization & Dashboard Enhancements (July 2026)

To stabilize the system and prepare it for integration with the core Rihla ecosystem, several bugs were patched, and the dashboard UI was enhanced:

### 1. ReliefWeb App Name Whitelisting
- **Issue:** ReliefWeb API v2 started returning `HTTP 403 Forbidden` for standard requests due to an unapproved `appname` query parameter.
- **Resolution:** Updated the adapter in `src/sources/noAuth/reliefweb.ts` to use the pre-approved credentials: `Rihla-Risk-8h9j24LbwzF32`. This whitelisted the requests and returned report data successfully.

### 2. GDELT Rate-Limiting & Timeout Adjustments
- **Issue 1:** GDELT API is notoriously slow and frequently timed out under the default 10s client timeout.
- **Issue 2 (Rate Limit):** Frequent local development restarts (caused by `npm run dev` with hot-reloading `tsx watch`) triggered multiple calls to GDELT within minutes, resulting in `HTTP 429 Rate-Limited` blocks.
- **Resolution:**
  - Increased `timeoutMs` in `gdeltUnrest.ts` to `30_000` (30 seconds) to accommodate slow responses.
  - Adjusted polling `intervalMinutes` to `60` in `config/sources.yaml` to diminish local IP blocks during development.

### 3. OpenWeather Event Deduplication Collisions
- **Issue:** The state aggregator (`currentState.ts`) deduplicates events strictly by matching the `source` and `rawRef` fields. Originally, the OpenWeather and OpenWeather Air adapters assigned a generic `rawRef: "openweathermap.org"` to all generated events. Consequently, only one single weather event could exist across all 11 monitored cities at any given time (subsequent cities/metrics were discarded as duplicates).
- **Resolution:** Updated `openWeather.ts` and `openWeatherAir.ts` to generate unique, descriptive `rawRef` strings incorporating the metric and city name:
  - UV Index: `openweathermap.org::uv::[city]`
  - Temperature: `openweathermap.org::temp::[city]`
  - Air Quality (AQI): `openweathermap.org::aqi::[city]`
  This allowed safe, multi-city meteorological tracking without duplicate collisions.

### 4. Interactive Dashboard Source Events Toggle (Accordion)
- **Feature:** Designed an interactive expand/collapse toggle interaction on the health dashboard (`src/public/dashboard.html`).
- **Functionality:**
  - Users can click on any source row inside the **Source Health** table to expand a drawer listing the raw, unfiltered events received from it.
  - Draws data dynamically from the `/safety/current` payload.
  - Preserves the expanded or closed state of each row across the automatic 15-second dashboard refresh intervals.
  - Pure vanilla JS and CSS to avoid adding bloated dependencies that could break production container staging.

