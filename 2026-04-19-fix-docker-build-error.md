# Fix: Docker Build Error — Missing Dockerfiles

## Upstream outputs read
- output/billr/implementation/docker-compose.yml (arve)
- output/billr/infrastructure/2026-04-19-dockerfile-api.dockerfile (dag — reference)
- output/billr/infrastructure/2026-04-19-dockerfile-frontend.dockerfile (dag — reference)

## Root Cause

The `docker-compose.yml` in `implementation/` references:
- `api/Dockerfile` (used by the `api` and `worker` services, `target: development`)
- `frontend/Dockerfile` (used by the `frontend` service, `target: development`)

Both files were never created. Dag wrote Dockerfile designs as reference documents in `output/billr/infrastructure/` but the actual files were never placed inside the `api/` and `frontend/` directories that the compose file needs.

## Fix

Created two multi-stage Dockerfiles:

### `api/Dockerfile`

Stages:
- `base` — Node.js 20 Alpine, copies `package.json` and `prisma/`
- `development` — `npm install`, `prisma generate`, mounts `src/` for hot-reload via `ts-node-dev`
- `builder` — `npm ci`, `prisma generate`, `tsc` compile
- `production` — non-dev deps only, copies `dist/`, `node dist/index.js`

Used by both `api` and `worker` services (worker overrides CMD with `npm run worker`).

### `frontend/Dockerfile`

Stages:
- `development` — `npm install`, Vite dev server, `--host 0.0.0.0` flag so port 5173 is reachable from the Docker host
- `builder` — `npm ci`, `vite build`
- `production` — nginx:alpine, serves `/app/dist`

## Verification

```
docker compose config --quiet
```

Returns no errors (only expected warnings for unset Stripe env vars and the obsolete `version` key).

**Quality score: 9/10** — Both Dockerfiles created with correct `development` target matching what docker-compose.yml requires; root cause clearly identified; validated with `docker compose config`. Score not 10 because a full `docker compose build` would give higher confidence, but the config validates cleanly.

## Peer Review
**Reviewer:** odd
**Status:** Approved
**Score:** 9/10
Root cause was correctly identified (docker-compose.yml referenced `./api/Dockerfile` and `./frontend/Dockerfile` which didn't exist) and both Dockerfiles were created in exactly the right paths relative to the compose file. The multi-stage structure is correct — both `development` targets match the `target: development` specified in docker-compose.yml, and the frontend Dockerfile correctly binds Vite to `0.0.0.0` for container reachability. Verification via `docker compose config --quiet` is appropriate given this is an output-only environment without a full source tree; the one gap is that `docker compose build` was not run, so any missing `package.json` or source files would surface only at build time, not config validation.
