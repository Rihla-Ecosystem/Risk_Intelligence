# Risk_Intelligence — Handoff

> Read relevant section only. Appends 3–6 lines. Prune Changelog > 25.
> Last updated: 2026-08-07

## Current status
- Service UP on 3001 (`.env PORT=3001`; `node dist/index.js`, setsid nohup). Polling enabled; `/safety/health` OK (11 sources, gdelt+reliefweb+state_dept 403/unreachable = transient upstream).
- Checkpoints present.

## In-progress / next
- (Resume) merged origin/main a29db25 (route "fix").

## Merge note (security regression FIXED)
- Remote commit 7926d01 neutered `authHook` on `POST /safety/refresh` (removed internal-key + admin-JWT check → endpoint became public). RESTORED the full authHook body (route already uses it as preHandler). Auth re-verified: 401 without key, 200 with `X-Internal-Api-Key`. GET routes remain open (by design).
- Tests: 30 severity rules (60 with dist dup) pass.

## Architecture snapshot
- Cron per adapter (`*/intervalMinutes * * * *`). First poll = next tick → use `POST /safety/refresh` for immediate data.
- Adapter path: acquireLock (file `wx`, stale after 2x interval) → readCheckpoint → fetchData OR buildRequest→fetch→parse → mergeIntoCurrentState → writeCheckpointAtomic (tmp+rename) → releaseLock.
- Severity: 7 pure functions (earthquake/uv/temp/aqi/fire/advisory/text keyword cascade). overallRisk = max per city.
- Dedup by `source::rawRef`; per-source events replaced each poll ("last write wins"); event_log capped 1000.
- 11 cities in `EGYPT_CITIES`; `nearestCity(lat,lon)` uses Euclidean approx.

## Key facts
- Env: `OPENWEATHER_API_KEY`, `FIRMS_MAP_KEY`, `ACLED_EMAIL/PASSWORD`, `CDS_API_KEY`, `AUTH_TOKEN`, `DATA_DIR`, `PORT`.
- Disabled by default: acled, glofas. ReliefWeb needs appname whitelist (`Rihla-Risk-8h9j24LbwzF32`).
- Guide: `MODULE_GUIDE.md` (17 sections incl. adding a source).

## Gotchas
- Single-instance only (file locks are process-local).
- No event TTL — stale events persist until source poll / auto-disable.
- GDELT slow + rate-limited (raised timeout 30s, interval 60m).
- FCDO advisory uses content-hash dedup; WHO uses seenIds.
- OpenWeather dedup fixed via unique rawRef per metric+city.

## Changelog
- 2026-08-07: Created `AGENTS.md` + `CONTEXT.md`. Not started this session.
- 2026-08-07: Merged origin/main; restored refresh-endpoint auth (remote removed it). Tests 60/60. Running on 3001.