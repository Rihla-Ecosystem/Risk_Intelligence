# Risk Intelligence Module

Background polling engine that aggregates safety & risk data from ~15 external sources into a single JSON state per Egyptian city. Part of the **Rihla** AI tour guide system — keeps the safety picture current so the agent always has an accurate answer when a tourist asks "is it safe here right now?"

**Zero AI cost** — all classification is rule-based and deterministic.

---

## Project Status

### Goal
Build a production-ready risk intelligence module that collects data from ~13 free sources and provides a clean API contract for other modules (agent, notification service, dashboard).

### Constraints
- **Zero-cost** — no LLM/paid APIs, no database, no external AI. Deterministic rule-based severity only.
- **Single-instance file-based state** — no horizontal scaling, no DB. File locks + atomic writes for consistency.
- **All data sorted into a single endpoint per-city shape** — consumers don't need to know source formats.

### What's Done
- Fixed 3 dead API URLs: WHO (switched to new REST API), CDC (switched to RSS feed), ReliefWeb (V1→V2)
- Added `textSeverityClassifier()` — deterministic keyword matching replaces hardcoded "advisory" on GDELT, ReliefWeb, WHO, CDC
- LLM summarizer path removed entirely (`llmSummarizer.ts` deleted)
- `fetchData()` interface method on `SourceAdapter` for multi-fetch adapters (OpenWeather 11 cities, GloFAS subprocess)
- `consecutiveFailures` tracking with auto-disable after 5 failures
- Dedup by `source + rawRef` in state merge
- Error logging to `data/fetch_errors.log` (no retry on 4xx except 429)
- Heatwave headlines (temp ≥40°C) and sand/dust storm detection from OpenWeather alerts
- Static safety notes for all 11 Egyptian cities
- ACLED conflict adapter (disabled by default — needs free account registration)
- Event log (`eventLog.ts`) — append-only, capped at 1000 entries on disk
- `GET /safety/changes?since=<ISO>&city=<name>` endpoint for delta queries
- `GET /safety/health` — per-source status from checkpoint files
- Optional auth middleware — `AUTH_TOKEN` env var gates all endpoints behind `X-API-Key`
- `DATA_DIR` env-configurable for Docker volume mounts
- Multi-stage `Dockerfile` (Node 22 alpine, Python for GloFAS sidecar) + `.dockerignore`
- TypeScript compiles clean, 30/30 vitest tests pass

### Blocked / Needs Manual Steps
- **ReliefWeb V2** returns 403 until `appname` is pre-approved via ReliefWeb API form — needs admin action
- **GloFAS sidecar** GRIB parsing not implemented (`enabled: false` until CDS account + xarray/cfgrib pipeline built)
- **ACLED adapter** `enabled: false` by default — user needs to register at acleddata.com for free account
- **Docker build** not verified in this environment (no Docker daemon available)

### Key Decisions
- **Zero LLM cost**: `textSeverityClassifier()` replaces any LLM routing. Keyword-matched severity on all text sources.
- **`fetchData()` interface method** for adapters that don't fit the single-URL poller model (OpenWeather multi-city, GloFAS subprocess). Avoids `internal://` URL hacks.
- **File-based event log** instead of a database — append to JSON file capped at 1000 entries. On-disk (survives restart) vs in-memory.
- **Optional shared-secret auth** — `AUTH_TOKEN` env var → `X-API-Key` header required. Backward-compatible (unset = open).
- **Keep GDELT alongside ACLED** — GDELT is noisy early-warning, ACLED is structured geo-tagged conflicts. Both run, ACLED disabled by default until credentials configured.

### Next Steps
- Register `appname` at ReliefWeb API form to unblock V2 access
- Register for free ACLED account and set `ACLED_EMAIL`/`ACLED_PASSWORD` → set `enabled: true` in `sources.yaml`
- Consider HDX IHR monitoring framework CSV as one-time static import for health system context (not urgent)
- Deploy via Docker: `docker build -t risk-intelligence . && docker run ...` with `-v risk-data:/app/data` for persistence

### Critical Context
- **3 source URLs were dead** — WHO RSS (404), CDC API (404), ReliefWeb V1 (410). All fixed but unverified against live endpoints in this environment.
- **OpenWeather API returns raw temp** — heatwave headlines and dust storm detection added to existing adapter code, no new API calls needed.
- **GDELT 429 rate-limiting** still possible at 20min polling; `fetchWithRetry` handles 429 with `Retry-After` header.
- **ACLED OAuth flow** — access tokens last 24h, refresh tokens 14d. Token data persisted in checkpoint file. Falls back to fresh login if both expired.
- **State is file-based** — `current_state.json`, per-source checkpoints in `data/checkpoints/`, event log at `data/event_log.json`. All respect `DATA_DIR` env var. Works for single-instance only.

### Key Files

| Path | Purpose |
|------|---------|
| `src/engine/models.ts` | Core types (`RiskEvent`, `SourceAdapter`, `Checkpoint`, `EGYPT_CITIES`) |
| `src/engine/poller.ts` | Generic poller with lock, retries, failure tracking, and `fetchData` support |
| `src/engine/checkpoint.ts` | File-based locks + atomic checkpoint writes per source |
| `src/engine/currentState.ts` | State aggregation + dedup + event log integration |
| `src/engine/eventLog.ts` | Append-only log (capped 1000), powers `/safety/changes` |
| `src/engine/health.ts` | Reads checkpoints to report per-source health |
| `src/engine/httpClient.ts` | fetch wrapper with retry, 4xx/429 handling, error logging |
| `src/severity/rules.ts` | All deterministic severity classifiers |
| `src/api/routes.ts` | 3 endpoints (`/current`, `/changes`, `/health`) + optional auth hook |
| `src/index.ts` | Entry point — bootstraps scheduler + Fastify server |
| `src/sources/withKey/openWeather.ts` | Heatwave + dust storm detection from existing OneCall data |
| `src/sources/withKey/acledUnrest.ts` | ACLED adapter (new, disabled by default) |
| `src/sources/noAuth/whoOutbreak.ts` | Rewritten to use new REST API |
| `src/sources/noAuth/cdcTravelHealth.ts` | Rewritten to use RSS feed |
| `src/sources/noAuth/reliefweb.ts` | URL fixed to V2 |
| `src/sources/noAuth/gdeltUnrest.ts` | Updated to use `textSeverityClassifier` |
| `data/static_safety_notes.json` | Curated notes for all 11 cities |
| `config/sources.yaml` | Source registry with intervals, auth type, enable flags |
| `Dockerfile` | Multi-stage build (Node 22 + Python for sidecar) |

---

## Architecture

```
  USGS  EMSC  NOAA  ReliefWeb  GDELT  WHO  CDC
  FCDO  State Dept  OpenWeather  FIRMS  ACLED  GloFAS
             │  (parallel polling via node-cron)
             ▼
┌─────────────────────────────────────────────────────────┐
│  Generic Poller (poller.ts)                              │
│  • File-based lock per source (staleness detection)     │
│  • Per-source checkpoints (atomic write)                │
│  • Retry with exponential backoff                       │
│  • Auto-disable after 5 consecutive failures            │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Severity Classifier (rules.ts)                         │
│  • 7 deterministic functions (no LLM)                   │
│  • Keyword-based text classifier for news sources       │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Aggregated State (current_state.json)                  │
│  • Per-city event list + overallRisk                    │
│  • Event log (last 1000 entries) for change tracking    │
│  • Dedup by source + rawRef                             │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  HTTP API (Fastify, port 3000)                          │
│  GET /safety/current?city=cairo                         │
│  GET /safety/changes?since=ISO                          │
│  GET /safety/health                                     │
│  Optional X-API-Key auth                                │
└─────────────────────────────────────────────────────────┘
```

---

## Data Sources

### No Credentials Required (9 sources)

| Source | Data | Interval | Endpoint | Status |
|--------|------|----------|----------|--------|
| **USGS Earthquake** | Seismic events ≥ M3, Egypt bbox | 15 min | `earthquake.usgs.gov/fdsnws/event/1/query` | ✅ Live |
| **EMSC Seismic** | Seismic events, radius around Egypt | 15 min | `www.seismicportal.eu/fdsnws/event/1/query` | ✅ Live |
| **NOAA Tsunami** | Tsunami warnings/advisories | 60 min | `api.weather.gov/alerts/active` | ✅ Live |
| **GDELT Unrest** | News articles matching protest/unrest/clash | 20 min | `api.gdeltproject.org/api/v2/doc/doc` | ✅ Live |
| **ReliefWeb** | Humanitarian reports for Egypt | 360 min | `api.reliefweb.int/v2/reports` | ⚠️ Needs appname registration |
| **State Dept** | Travel advisory level for Egypt | 720 min | HTML scrape of travel.state.gov | ✅ Live |
| **FCDO** | UK travel advice for Egypt | 720 min | `www.gov.uk/api/content/foreign-travel-advice/egypt` | ✅ Live |
| **WHO Outbreak** | Disease Outbreak News | 720 min | `www.who.int/api/news/diseaseoutbreaknews` | ✅ Live |
| **CDC Travel Health** | Travel health notices | 720 min | `wwwnc.cdc.gov/travel/rss/notices.xml` | ✅ Live |

### API Key Required (5 sources)

| Source | Data | Interval | Env Var | Status |
|--------|------|----------|---------|--------|
| **OpenWeather Current** | UV index, temperature, weather alerts for 11 cities | 20 min | `OPENWEATHER_API_KEY` | ✅ Live |
| **OpenWeather Air** | AQI (PM2.5) for 11 cities | 30 min | `OPENWEATHER_API_KEY` | ✅ Live |
| **NASA FIRMS** | Fire hotspots via satellite (VIIRS) | 60 min | `FIRMS_MAP_KEY` | ✅ Live |
| **ACLED** | Structured conflict events (protests, battles, riots) | 60 min | `ACLED_EMAIL`, `ACLED_PASSWORD` | 🔒 Disabled (enable in `sources.yaml` after registering at acleddata.com) |
| **GloFAS Flood** | River flood forecast data, GRIB → subprocess | 360 min | `CDS_API_KEY` | 🔒 Disabled (GRIB parsing not implemented) |

### Deferred / Not Wired (2 sources)

| Source | Reason |
|--------|--------|
| **Numbeo Crime** | Paid API; covered by static safety notes |
| **GeoSure Safety** | Commercial API; covered by static safety notes |

### Static Fallback

- **`data/static_safety_notes.json`** — manually curated safety notes for all 11 Egyptian cities
- **HDX WHO data** — 35+ CSV files of Egypt health indicators (IHR capacity, workforce, disease prevalence) — available for one-time static import, not real-time polling

---

## Risk Categories & Severity

### Categories
`seismic` · `weather` · `fire` · `flood` · `unrest` · `health` · `crime` · `advisory` · `tsunami`

### Severity Levels
| Level | Meaning |
|-------|---------|
| `info` | No notable risk |
| `advisory` | Worth noting, no immediate danger |
| `warning` | Real safety impact — take precautions |
| `critical` | Immediate danger — avoid area |

### Deterministic Rules (all in `src/severity/rules.ts`)

| Function | Input | `info` | `advisory` | `warning` | `critical` |
|----------|-------|--------|------------|-----------|------------|
| `earthquakeSeverity` | Magnitude | < 3.5 | ≥ 3.5 | ≥ 5.0 | ≥ 6.5 |
| `uvIndexSeverity` | UV Index | < 6 | ≥ 6 | ≥ 8 | ≥ 11 |
| `tempSeverity` | °C | < 36 | ≥ 36 | ≥ 40 | ≥ 45 |
| `aqiSeverity` | AQI (1–5) | 1–2 | 3 | 4 | 5 |
| `fireConfidenceSeverity` | Confidence %, FRP | < 30% | ≥ 30% | ≥ 60% or (≥80% & FRP<50) | ≥80% & FRP≥50 |
| `advisoryLevelSeverity` | Govt advisory level | 1 | 2 | 3 | 4+ |
| `textSeverityClassifier` | News headline/text | neutral | risk/unrest/protest | outbreak/casualty/warning | death/fatal/emergency |

---

## Monitored Cities

All 11 Egyptian cities with geo-coordinates in `src/engine/models.ts`:

| City | Key | Risk Notes |
|------|-----|------------|
| Cairo | `cairo` | Standard urban caution |
| Giza | `giza` | Pyramid area well-patrolled |
| Alexandria | `alexandria` | Corniche safe, avoid isolated beaches at night |
| Luxor | `luxor` | East Bank safe, West Bank needs guide |
| Aswan | `aswan` | Low crime, standard Nile-side caution |
| Hurghada | `hurghada` | Resorts secure, marine safety briefings |
| Sharm el-Sheikh | `sharm_el_sheikh` | Airport/resort zone secure, avoid Sinai interior |
| Dahab | `dahab` | Low crime, Blue Hole only with certified operators |
| Marsa Alam | `marsa_alam` | Remote, limited medical facilities |
| El Gouna | `el_gouna` | Gated resort, very low crime |
| Siwa Oasis | `siwa_oasis` | Remote desert — travel in convoy, limited mobile coverage |

---

## API Endpoints

All endpoints are registered at `http://localhost:3000/safety/*`.

### `GET /safety/current`

Returns full current risk state.

**Query params:**
- `city` (optional) — city key from table above. If omitted, returns all cities.

**Response (with city):**
```json
{
  "city": "cairo",
  "updatedAt": "2026-07-05T08:00:00.000Z",
  "events": [
    {
      "source": "openweather_current",
      "category": "weather",
      "severity": "advisory",
      "city": "cairo",
      "lat": 30.0444,
      "lon": 31.2357,
      "headline": "UV index 7 in cairo",
      "effectiveTime": "2026-07-05T08:00:00.000Z",
      "rawRef": "openweathermap.org"
    }
  ],
  "overallRisk": "advisory",
  "staticNote": {
    "note": "Downtown and Zamalek generally safe for tourists; standard urban caution advised at night.",
    "level": "info"
  }
}
```

### `GET /safety/changes`

Returns events logged after a timestamp. Useful for notification services and the agent to discover "what's new" without diffing the full state.

**Query params:**
- `since` (required) — ISO timestamp, e.g. `2026-07-05T08:00:00Z`
- `city` (optional) — filter by city

**Response:**
```json
{
  "events": [
    {
      "loggedAt": "2026-07-05T08:15:00.000Z",
      "source": "usgs_earthquake",
      "city": "cairo",
      "severity": "advisory",
      "category": "seismic",
      "headline": "M 3.7 - 15 km NE of Cairo",
      "rawRef": "..."
    }
  ],
  "count": 1
}
```

### `GET /safety/health`

Returns per-source health status. Reads from checkpoint files — no extra infrastructure.

**Response:**
```json
{
  "status": "ok",
  "time": "2026-07-05T08:00:00.000Z",
  "sources": [
    { "name": "cdc_travel_health", "enabled": true, "bootstrapped": true, "lastSuccessAt": "...", "lastError": null, "consecutiveFailures": 0, "autoDisabled": false },
    { "name": "who_outbreak", "enabled": true, "bootstrapped": true, "lastSuccessAt": null, "lastError": "HTTP 404 for ...", "consecutiveFailures": 3, "autoDisabled": false }
  ]
}
```

### Auth (optional)

Set `AUTH_TOKEN` in `.env`. If set, all endpoints require header:

```
X-API-Key: your-token-here
```

Returns **401** `{ "error": "unauthorized" }` on mismatch. If `AUTH_TOKEN` is unset, endpoints are open.

---

## Setup

### Prerequisites
- Node.js 22+
- Python 3 (for GloFAS sidecar — optional)

### Quick Start

```bash
cp .env.example .env
# Fill in API keys (OPENWEATHER_API_KEY, FIRMS_MAP_KEY required for full data)
npm install
npm run dev
```

### API Keys

**Required for full functionality:**
- `OPENWEATHER_API_KEY` — free tier at [openweathermap.org](https://openweathermap.org/api) (covers UV, temp, AQI for all 11 cities)
- `FIRMS_MAP_KEY` — free at [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/api/area/)

**Optional:**
- `ACLED_EMAIL` / `ACLED_PASSWORD` — free at [acleddata.com/register](https://acleddata.com/register) for structured conflict data
- `CDS_API_KEY` — Copernicus Climate Data Store for GloFAS flood data

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot-reload (tsx watch) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled JS from `dist/` |
| `npm test` | Run vitest unit tests (30+ tests) |
| `npm run test:watch` | Tests in watch mode |

---

## Docker

```bash
# Build
docker build -t risk-intelligence .

# Run
docker run -d -p 3000:3000 \
  -e OPENWEATHER_API_KEY=your-key \
  -e FIRMS_MAP_KEY=your-key \
  -e AUTH_TOKEN=your-secret \
  -v risk-data:/app/data \
  risk-intelligence
```

The image uses Node.js 22 Alpine (~180 MB). Python 3 is included in the runtime image for the GloFAS sidecar (optional — sidecar is disabled by default).

---

## Project Structure

```
├── config/
│   └── sources.yaml              # Source registry (enabled/interval/auth)
├── data/
│   ├── current_state.json         # Aggregated risk state (runtime)
│   ├── event_log.json             # Change log, last 1000 entries (runtime)
│   ├── static_safety_notes.json   # Manually curated city safety notes
│   └── checkpoints/               # Per-source checkpoint + lock files (runtime)
├── src/
│   ├── index.ts                   # Entry point — boots scheduler + Fastify
│   ├── api/
│   │   └── routes.ts              # 3 endpoints + optional X-API-Key auth
│   ├── engine/
│   │   ├── models.ts              # RiskEvent, SourceAdapter, Checkpoint, 11 cities
│   │   ├── poller.ts              # Generic polling loop (lock→fetch→parse→merge)
│   │   ├── scheduler.ts           # node-cron per-source scheduling
│   │   ├── checkpoint.ts          # File-based checkpoint CRUD + locks
│   │   ├── currentState.ts        # State read/merge/write
│   │   ├── eventLog.ts            # Change log (append, cap at 1000)
│   │   ├── health.ts              # Per-source health from checkpoints
│   │   └── httpClient.ts          # fetch wrapper (retry, timeout, error logging)
│   ├── severity/
│   │   └── rules.ts               # 7 deterministic severity functions
│   ├── sources/
│   │   ├── noAuth/                # 9 API-key-free adapters
│   │   ├── withKey/               # 5 API-key adapters (OpenWeather × 2, FIRMS, ACLED, GloFAS)
│   │   └── deferred/              # Stubs for paid sources (Numbeo, GeoSure)
│   ├── sidecars/
│   │   └── glofas/                # Python subprocess for GloFAS GRIB (disabled)
│   └── __tests__/
│       └── rules.test.ts          # 30 unit tests for severity rules
├── Dockerfile                     # Multi-stage build (Node 22 + Python 3)
├── .dockerignore
├── tsconfig.json
├── .env.example
├── .gitignore
└── package.json
```

---

## Key Design Decisions

### Why file-based state instead of a database?
Fine for single-instance. The state file is ~50 KB for all cities. Checkpoint files are ~200 bytes each. Atomic writes via temp-file-then-rename prevent corruption. If horizontal scaling is needed, swap in a shared datastore (Redis, Postgres) behind the same `Checkpoint` / `CurrentState` interface.

### Why no AI/LLM?
All severity classification is rule-based (thresholds for numeric data, keyword matching for text). This keeps the module's cost at $0 (no API calls), latency at ~0ms (no network to an LLM), and behavior perfectly deterministic. The `textSeverityClassifier` uses curated keyword lists — not as nuanced as an LLM, but free and predictable.

### Why a generic `SourceAdapter` interface instead of 15 scripts?
Every adapter implements the same three methods (`buildRequest`, `parse`, `nextCheckpoint`), so one shared poller handles locking, retries, checkpointing, and failure handling identically for every source. Adding a new source means writing one file with ~30 lines.

### Why `fetchData` for some adapters?
Sources that need multiple fetches per poll (OpenWeather — 11 cities) or a subprocess (GloFAS) don't fit the single-fetch model. The optional `fetchData` method on `SourceAdapter` bypasses the standard flow and lets the adapter manage its own fetching while still using the shared locking, checkpointing, and state merge.

### Source health & auto-disable
Each source tracks `consecutiveFailures` in its checkpoint. After 5 consecutive failures, the source auto-disables itself — it won't retry until the module restarts. The health endpoint (`/safety/health`) exposes this so an ops dashboard can alert on it.

### Event log for change tracking
The event log (`data/event_log.json`, capped at 1000 entries) records every new event with a timestamp. Other modules poll `/safety/changes?since=<timestamp>` to discover what's new without needing to diff the full state or maintain their own cursor.

---

## Agent Integration Guide

This section is for developers building AI agents (chatbots, voice assistants, automated notifiers) that consume risk intelligence data.

### Architecture Overview for Agents

```
Your Agent ──► GET /safety/current?city=cairo  ──► JSON risk state
              GET /safety/changes?since=ISO     ──► JSON delta (new since last check)
              POST /safety/refresh?source=...   ──► Trigger immediate poll (optional)
```

The risk-intelligence module is a **source of truth, not a proxy**. It polls 15 sources, deduplicates, classifies severity, and presents a single merged view per city. Your agent never needs to touch USGS, WHO, OpenWeather, or GDELT directly.

### How an Agent Should Use the Data

#### 1. On user query — fetch current state

When a tourist asks "Is Cairo safe right now?", fetch the current state and let the agent decide how to present it.

```
GET /safety/current?city=cairo
```

```json
{
  "city": "cairo",
  "updatedAt": "2026-07-05T08:00:00.000Z",
  "overallRisk": "advisory",
  "events": [
    { "source": "usgs_earthquake", "category": "seismic", "severity": "info", "headline": "M 3.7 - 15 km NE of Cairo", ... },
    { "source": "openweather_current", "category": "weather", "severity": "warning", "headline": "UV index 10.85 in cairo", ... },
    { "source": "openweather_air", "category": "weather", "severity": "advisory", "headline": "AQI 3 in cairo (PM2.5: 27.51)", ... }
  ],
  "staticNote": { "headline": "Downtown and Zamalek generally safe for tourists; standard urban caution advised at night.", "level": "info" }
}
```

**Agent prompt pattern:**
```
You are a travel safety advisor. Given a city risk state, summarize
the situation clearly for a tourist visiting Egypt.

Risk state: { insert JSON }

Provide:
- Overall assessment (green/yellow/red)
- Active warnings (explain them simply)
- Precautions relevant to current conditions
- Weather-specific advice (UV, heat, AQI)
```

#### 2. Background polling — track changes

Your agent can poll `/safety/changes` periodically (every 5-10 minutes) to detect new events without re-processing the full state. Save the `since` timestamp from each response and use it as the `since` parameter on the next call.

```
GET /safety/changes?since=2026-07-05T08:00:00Z&city=cairo
```

```json
{
  "events": [
    {
      "loggedAt": "2026-07-05T08:10:00.000Z",
      "source": "usgs_earthquake",
      "severity": "warning",
      "headline": "M 5.2 - 15 km NE of Cairo",
      "city": "cairo",
      "category": "seismic",
      "rawRef": "usgs.gov"
    }
  ],
  "count": 1
}
```

**Agent prompt pattern:**
```
You have received a risk update for Cairo:
{ insert JSON event }

Decide if this warrants:
1. A proactive notification to the user
2. An update to your internal state (record it)
3. Ignoring (if severity is 'info' and category is routine)
```

#### 3. Severity-based alerting

The `overallRisk` field is the highest severity across all events for that city. Your agent can use it as a quick "should I notify?" gate:

| overallRisk | Agent behavior |
|-------------|---------------|
| `info` | No action needed |
| `advisory` | Mention in passing if asked |
| `warning` | Proactively notify — "Heads up, there's a potential issue in Cairo..." |
| `critical` | Push notification — "⚠️ Immediate safety concern in your area" |

### Client Code Examples

#### Python (for agent backend)

```python
import httpx
from datetime import datetime, timezone

BASE = "http://localhost:3000"
AUTH_TOKEN = None  # set if configured on server

HEADERS = {}
if AUTH_TOKEN:
    HEADERS["X-API-Key"] = AUTH_TOKEN

def get_city_state(city: str) -> dict:
    res = httpx.get(f"{BASE}/safety/current", params={"city": city}, headers=HEADERS)
    res.raise_for_status()
    return res.json()

def get_changes(since: datetime, city: str | None = None) -> dict:
    params = {"since": since.isoformat()}
    if city:
        params["city"] = city
    res = httpx.get(f"{BASE}/safety/changes", params=params, headers=HEADERS)
    res.raise_for_status()
    return res.json()

def trigger_refresh(source: str | None = None) -> dict:
    params = {}
    if source:
        params["source"] = source
    res = httpx.post(f"{BASE}/safety/refresh", params=params, headers=HEADERS)
    res.raise_for_status()
    return res.json()

# Example: periodic change tracker
last_check = datetime.now(timezone.utc)
while True:
    changes = get_changes(last_check)
    for event in changes["events"]:
        if event["severity"] in ("warning", "critical"):
            # dispatch notification
            pass
    last_check = datetime.now(timezone.utc)
    time.sleep(300)  # 5 minutes
```

#### JavaScript / TypeScript (for agent backend or browser)

```typescript
const BASE = "http://localhost:3000";
const headers: Record<string, string> = {};
if (process.env.AUTH_TOKEN) headers["X-API-Key"] = process.env.AUTH_TOKEN;

async function getCityState(city: string) {
  const res = await fetch(`${BASE}/safety/current?city=${city}`, { headers });
  return res.json();
}

async function getChangesSince(since: string, city?: string) {
  const params = new URLSearchParams({ since });
  if (city) params.set("city", city);
  const res = await fetch(`${BASE}/safety/changes?${params}`, { headers });
  return res.json();
}
```

### Best Practices

| Rule | Reason |
|------|--------|
| **Poll `/safety/current` on user query, not on a timer** | The state is updated by the module's scheduler — there's no benefit to polling it every 30 seconds. Query it when the user asks a question. |
| **Poll `/safety/changes` on a timer (5-10 min)** | Lightweight delta endpoint. Use it to detect new events and decide if a proactive notification is needed. |
| **Save the `since` cursor in your agent's state** | The event log is capped at 1000 entries. If your agent goes offline for hours, you may miss events. Poll at least every 60 minutes. |
| **Use `overallRisk` as the alerting gate** | Don't parse individual events to decide whether to notify — `overallRisk` is already the max severity. |
| **Handle 401 responses gracefully** | If `AUTH_TOKEN` is set and you don't provide the header, you get 401. Don't retry in a tight loop. |
| **Do NOT cache the state aggressively** | The state is ~50 KB for all cities. Fetch it when you need it — it's fast (<10ms server-side). |
| **Treat `severity` as authoritative** | The module applies deterministic rules across all sources. Don't re-classify events in your agent — trust the severity. |

### Auth Configuration

If the module is deployed with `AUTH_TOKEN=your-secret` in `.env`, all endpoints require the header:

```
X-API-Key: your-secret
```

Configure this in your agent client. Without the header, the module returns HTTP 401.
If `AUTH_TOKEN` is not set, all endpoints are open.

### Multi-Agent Architecture

```
User ──► Chat Agent ──► Risk Intel Module
                         │
                         ├── USGS, EMSC, NOAA...
                         ├── WHO, CDC, ReliefWeb...
                         ├── OpenWeather, FIRMS...
                         └── GDELT, ACLED, FCDO...
```

The risk module acts as a **backing service** behind your agent. The agent does not directly call external APIs — it calls the module, which aggregates and classifies everything. This means:

- Your agent has **one integration** instead of 15
- The agent gets **pre-classified severity** (no prompt engineering for "how bad is a 5.2 earthquake?")
- The module handles **retries, dedup, health monitoring** — your agent doesn't need to know
- **No API keys leak** to the agent — keys live in the module's env

---

## Testing

```bash
npm test
```

30 unit tests covering all 7 severity functions in `rules.ts`:
- Boundary conditions for every severity threshold
- Case-insensitive text matching
- Edge cases (null inputs, empty strings, mixed severity signals)

---

## Extension Guide

### Add a new data source

1. Create `src/sources/<category>/yourSource.ts` implementing `SourceAdapter`
2. Add to `ALL_ADAPTERS` in `src/index.ts`
3. Add config entry in `config/sources.yaml`
4. Add env vars to `.env.example` if applicable

The adapter needs:
```typescript
import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";

export const yourSource: SourceAdapter = {
  name: "your_source",
  intervalMinutes: 60,
  enabled: true,

  buildRequest(checkpoint: Checkpoint): { url: string; init?: RequestInit },
  parse(raw: unknown, checkpoint: Checkpoint): RiskEvent[],
  nextCheckpoint(raw: unknown, events: RiskEvent[], prev: Checkpoint): Checkpoint,
};
```

If your source needs custom fetching (multi-fetch, subprocess), add `fetchData`:

```typescript
async fetchData(checkpoint: Checkpoint): Promise<{ raw: unknown; events: RiskEvent[] }>
```

### Add a new severity rule

Add a function to `src/severity/rules.ts` that returns `Severity` based on your input. Add tests to `src/__tests__/rules.test.ts`.
