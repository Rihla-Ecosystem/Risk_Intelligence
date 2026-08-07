# Risk_Intelligence — Context

> Auto-loaded when working here. Keep SHORT.
> Mid-task state: `read CONTEXT.md` (relevant section) first.

## What
Fastify + node-cron, file-based (no DB). Background poller aggregating 11–15 external safety sources into a per-city JSON risk picture for 11 Egyptian cities. Deterministic severity rules. Dashboard SPA at `/`.

## Run / test
- Dev: `npm run dev` (tsx watch, port 3000)
- Build: `npm run build` · prod: `npm start`
- Test: `npm test` (30 tests on severity/rules.ts, <1s)
- Docker: `docker compose up --build` (port 3004 per platform compose)
- Force refresh: `curl -X POST localhost:3000/safety/refresh`

## External contract
- Serves `GET /safety/current?city=`, `/safety/changes?since=`, `/safety/health`, `POST /safety/refresh`
- Called by Core-Server + ai-service for live safety context
- Optional auth: `AUTH_TOKEN` env → `X-API-Key` header (no-op if unset)
- `DATA_DIR` env overrides state dir (default `./data`)

## Key files
- `src/engine/poller.ts` (lock→checkpoint→fetch→merge→write) · `src/engine/scheduler.ts` (cron)
- `src/severity/rules.ts` (7 classifiers) · `src/sources/` (noAuth 9 + withKey 5 + deferred stubs)
- `config/sources.yaml` (enable/interval registry) · `src/public/dashboard.html`
- State: `data/current_state.json`, `data/event_log.json`, `data/checkpoints/*.json`

## Standing rules (enforced reflex)
1. At the end of every task, append a 3–6 line checkpoint to this module's `CONTEXT.md`.
2. At session start, `read` the needed `CONTEXT.md` section before working.
3. Only read sections you need — never dump whole files into replies.
4. Never commit/log `.env` secrets. Match `JWT_ACCESS_SECRET` across services.