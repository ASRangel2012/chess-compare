# Chess Compare

Compare two [Chess.com](https://www.chess.com) players — ratings, openings, head-to-head history, game patterns, and AI-generated play style insights.

## Architecture

This is a **split frontend + lightweight backend** app:

| Layer | Tech | Role |
|-------|------|------|
| **Frontend** | React 19 + Vite + TypeScript | UI dashboard; calls Chess.com public API directly from the browser |
| **Backend** | Express.js (Node) | Proxies Claude/Anthropic API so your API key stays server-side; serves the built SPA in production/Docker |

Chess.com data (profiles, stats, PGN archives) is fetched **client-side** — their public API supports browser CORS and needs no auth.

The backend only handles:
- `POST /api/analyze` — sends aggregated game stats to Claude and returns play-style profiles (per-IP rate limited)
- `GET /api/health/live` / `GET /api/health/ready` — liveness and readiness probes (`GET /api/health` is kept as a compatibility alias); neither leaks configuration detail
- `GET /metrics` — Prometheus metrics for dashboards and alerts (request durations, Claude latency and token usage, rate-limit and load-shed counters, concurrency saturation)

The Anthropic API key stays server-side and is never exposed to the browser. `/api/analyze` is rate limited (10 requests/min per IP, in-memory) so a public deployment can't be abused to burn your API budget. Independently of the per-IP limit, a global concurrency cap (`ANALYZE_MAX_CONCURRENT`, default 4) bounds simultaneous upstream Claude calls; when saturated the endpoint sheds load immediately with `503` + `Retry-After` instead of queueing.

### `/api/analyze` status codes

| Status | Meaning |
|--------|---------|
| `200` | Parsed play-style insight |
| `400` | Missing or malformed player analysis in the request body — including names that aren't valid Chess.com usernames or fields exceeding server-side size bounds (everything in the body is interpolated into the Claude prompt, so the server validates format and length itself rather than trusting the client) |
| `429` | Per-IP rate limit exceeded (`Retry-After` header set) |
| `502` | Upstream reply unusable — didn't parse/validate, or was **truncated** at the token cap (raise `ANTHROPIC_MAX_TOKENS`) |
| `503` | No `ANTHROPIC_API_KEY` configured; the global concurrency cap is saturated; or Anthropic itself is rate limiting (429) / overloaded (529) — the latter two set `Retry-After` |
| `500` | Any other upstream/internal failure |

In **development**, Vite runs on `:5173` and proxies `/api` → Express on `:3001`.
In **production/Docker**, a single Express process serves both the static React build and the API on `:3001`.

## Features

- Player profiles & rating comparison (bullet, blitz, rapid, daily)
- Opening analysis from recent PGN data
- **Head-to-head history** — scans monthly archives for direct matchups
- **Inline game replay** — step through any head-to-head game on a board, powered by a small dependency-free PGN/SAN engine (`src/lib/chess.ts`). If a PGN contains a move the engine can't apply, the replay stops at the last good position and shows a warning instead of silently rendering a wrong board. The board is screen-reader accessible (`role="img"` position label + live move announcements).
- Game length distribution
- AI play style profiles via Claude
- **Sticky section navigation** — jump between Players / Ratings / Openings / Head-to-Head / AI Analysis / Game Plan once results load
- **Cancellation-aware loading** — starting a new comparison aborts the previous run's in-flight Chess.com requests (up to dozens of archive fetches) instead of letting them race the new run

## Local development

```bash
cd Projects/chess-compare
npm install
cp .env.example .env
# Add ANTHROPIC_API_KEY=sk-ant-... to .env
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). `npm run dev` picks the first free
API port starting at `3001` and points the Vite proxy at it, so a busy port won't
break startup.

## Configuration

The backend reads these from `.env` (loaded via `dotenv`):

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ANTHROPIC_API_KEY` | AI analysis only | — | Server-side key for the Claude proxy. Never sent to the browser. |
| `ANTHROPIC_MODEL` | No | `claude-haiku-4-5` | Override the Claude model (e.g. `claude-sonnet-5` for longer, richer profiles). |
| `ANTHROPIC_MAX_TOKENS` | No | `4096` | Upper bound on the model's reply. The analysis is one JSON object (two profiles, a matchup, and a detailed game plan); verbose models like Sonnet need enough room or the reply is truncated at the cap and the API returns `502` with a "raise ANTHROPIC_MAX_TOKENS" message. |
| `ANALYZE_MAX_CONCURRENT` | No | `4` | Global cap on concurrent upstream Claude calls (each holds a server socket for up to `ANTHROPIC_TIMEOUT_MS`). When saturated, `/api/analyze` returns `503` + `Retry-After` immediately — no queueing. |
| `PORT` | No | `3001` | API port. The dev launcher auto-selects the next free port if this is taken; the Vite proxy follows it. |
| `CORS_ORIGIN` | No | *(any)* | Comma-separated allow-list of origins for the API. Omit for permissive CORS (fine in dev); set it to your site on a public deployment. |
| `LOG_LEVEL` | No | `info` | Minimum server log level (`debug` \| `info` \| `warn` \| `error`). Logs are emitted as structured JSON lines with a request id. |

### Running without an API key

Every Chess.com feature — profiles, rating/record comparison, openings, head-to-head
history, and the inline game replay — works with **no key**, because that data is fetched
client-side. Only the **AI Play Style Analysis** card needs `ANTHROPIC_API_KEY`; without
one it degrades gracefully (the card shows a "configure a key" message) and the rest of the
app is unaffected.

## Deployment

In production a single Express process serves both the built SPA and the API on one port:

```bash
npm run build
ANTHROPIC_API_KEY=sk-ant-... NODE_ENV=production npm start
```

Or use Docker (below). On a host (Render, Railway, Fly, a VPS, etc.), set
`ANTHROPIC_API_KEY` as an environment variable in the host's settings rather than committing
it. A hosted instance lets reviewers try the AI analysis without supplying their own key —
the key stays server-side, and the per-IP rate limit (10 req/min) guards the budget.

## Kubernetes

`k8s/` has ready-to-apply manifests: a Deployment (liveness/readiness probes on
`/api/health/live` / `/api/health/ready`, resource requests/limits, and a
`terminationGracePeriodSeconds` that outlasts the server's 10s forced-shutdown
backstop so SIGTERM draining can finish), a ClusterIP Service, and a
deliberately conservative HPA.

Two things to know before applying:

- **`CORS_ORIGIN` is required** — in production the server fails closed and
  refuses to boot without an explicit allow-list. Edit the placeholder origin
  in `k8s/deployment.yaml`.
- **Scaling caveat** — the per-IP rate limiter and the analyze concurrency cap
  are in-memory, i.e. *per pod*. Every extra replica multiplies both. See
  the comments in `k8s/hpa.yaml` before raising `maxReplicas`.

### Local cluster (kind)

```bash
kind create cluster
docker build -t chess-compare:local .
kind load docker-image chess-compare:local

# Optional — without it the app runs in its documented no-AI degraded mode:
kubectl create secret generic chess-compare \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-...

kubectl apply -f k8s/
kubectl rollout status deploy/chess-compare
kubectl port-forward svc/chess-compare 3001:80
```

Open [http://localhost:3001](http://localhost:3001). For minikube, replace the
image load step with `minikube image load chess-compare:local`.

Prometheus can scrape `/metrics` via the pod annotations already set in the
Deployment; if you put an Ingress in front, exclude `/metrics` from public
routing.

## Scaling limits

Honest constraints of the current single-instance design, what breaks first,
and what changes them:

- **The per-IP rate limiter is in-memory and per process.** N replicas hand one
  client N× the 10 req/min budget, and a rolling deploy resets every bucket.
  It is also a fixed window, so a client can burst up to 2× across a window
  boundary. When scaling out matters, move the buckets to a shared store
  (Redis token bucket / sliding window) — the limiter is already an injected
  factory (`server/rateLimit.ts`), so the swap stays contained.
- **The analyze concurrency cap is per process.** The real ceiling on
  simultaneous Claude calls — and on worst-case spend — is
  replicas × `ANALYZE_MAX_CONCURRENT`. Budget it per replica, or enforce it in
  a shared queue if the fleet grows.
- **What saturates first at 10× traffic is the AI endpoint, by design.**
  Chess.com data is fetched by each visitor's browser, so backend load is the
  Claude proxy plus static files. Overload surfaces as shed 503s
  (`analyze_shed_total`, `analyze_semaphore_in_use` pinned at `_max`) — alert
  on those, raise `ANALYZE_MAX_CONCURRENT`/replicas deliberately, and mind the
  spend multiplication above.

## IntelliJ IDEA / WebStorm

IDE metadata (`.idea/`, `.run/`) is intentionally **not** committed — a fresh
clone contains no IDE configuration. One-time setup:

1. **Open the project** — File → Open → select the `chess-compare` folder.
2. **Node.js** — Settings → Languages & Frameworks → Node.js: point the
   interpreter at a local Node 22+ install.
3. **Install dependencies** — `npm install` in the built-in terminal.
4. **Environment** — copy `.env.example` to `.env` and add your
   `ANTHROPIC_API_KEY` (optional; see "Running without an API key").

Then run everything through the npm scripts (see [Scripts](#scripts)):
`npm run dev` is the one-command default (API + Vite with hot reload), and each
script can be wrapped in an IDE run configuration if you prefer buttons.

TypeScript is split across `tsconfig.app.json` (React `src/`) and
`tsconfig.node.json` (`server/` + Vite config) so the IDE resolves both.

## Docker

```bash
cp .env.example .env
# Add ANTHROPIC_API_KEY to .env

docker compose up --build
```

Open [http://localhost:3001](http://localhost:3001).

Or build/run manually:

```bash
docker build -t chess-compare .
docker run -p 3001:3001 -e ANTHROPIC_API_KEY=sk-ant-... chess-compare
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite frontend + Express API (hot reload) |
| `npm run build` | Production React build + bundled server |
| `npm start` | Run production server (serves UI + API) |
| `npm run prod` | Build + start (used by IntelliJ **Production** run config) |
| `npm run typecheck` | Type-check the project (`tsc -b`) |
| `npm run lint` | ESLint (flat config) over client, server, shared, and scripts |
| `npm test` | Run the Vitest unit suite |
| `npm run test:watch` | Run Vitest in watch mode |

## Observability

The server emits structured JSON logs (one line per request with a request id,
status, and duration; every Claude call logs latency, token usage, and stop
reason) and serves Prometheus metrics at `GET /metrics` (text exposition,
dependency-free — see `server/metrics.ts`):

| Metric | Type | Use |
|--------|------|-----|
| `http_request_duration_seconds{method,route,status}` | histogram | per-route latency/error-rate SLOs |
| `anthropic_request_duration_seconds{outcome}`, `anthropic_requests_total{outcome}` | histogram + counter | Claude latency and failure rate |
| `anthropic_input_tokens` / `anthropic_output_tokens` | histograms | token spend distribution over time |
| `rate_limit_hits_total` | counter | per-IP abuse pressure (429s) |
| `analyze_shed_total`, `analyze_semaphore_in_use` / `_max` | counter + gauges | load shedding & saturation — alert when `in_use` pins at `max` |

Route labels collapse to a fixed set (`/api/analyze`, `/api/health`, `/metrics`,
`/api/other`, `spa`) so a scanner spraying URLs can't mint unbounded time
series. On a public deployment keep `/metrics` internal: scrape it over the pod
network and exclude the path at your ingress.

## Testing & CI

Unit tests live next to the code they cover (`src/lib/*.test.ts`, `server/*.test.ts`) and run on [Vitest](https://vitest.dev):

```bash
npm test
```

They cover:

- **Pure data layer** — PGN parsing (`deriveTimeClass`, `normalizeResult`, opening-name resolution), per-player aggregation, and head-to-head summarization.
- **Chess engine** (`chess.ts`) — replaying famous games move-by-move, including castling, en passant, promotion, explicit disambiguation, and the implicit *disambiguation-by-pin* case (king-safety fallback); plus no-silent-truncation regressions (every parsed SAN must apply, corrupt/ambiguous SAN flags `truncated`) and the bounded PGN-token memo cache.
- **Network layer** — mocked-`fetch` tests for the archive fetcher's concurrency limit, caching, early-stop, newest-first ordering, cancellation (abort mid-scan stops further fetches and doesn't poison the cache), and month-boundary cache behavior with an injected clock.
- **Comparison orchestration** (`compare.ts`, `progressiveLoad.ts`) — `Promise.allSettled` profile resolution, precise error mapping, AbortSignal threading, the stale-run race, and AI-vs-comparison error routing, tested with injected fakes (no network, no DOM).
- **Components** (`GameViewer`, `PlayStyleAnalysis`, `GamePlan`) — jsdom render tests for the replay controls (clamping, move-list jumps, reset on new game, the truncation warning) and the AI cards' loading/error/retry/empty states.
- **Server** (`analyze.ts`, `rateLimit.ts`, `semaphore.ts`, `app.ts`) — request validation, model-output parsing/shape-validation, the rate limiter, the concurrency semaphore, and the `/api/analyze` endpoint end-to-end with an injected Claude stub (503 / 400 / 429 / 502 truncation & parse / 200 paths).

`.github/workflows/ci.yml` runs two jobs on every push and pull request: lint,
type-check, unit suite, production build, and a production-dependency audit on
Node 22 (matching the Docker base image); and a Docker job that builds the
image and smoke-tests the booted container against `/api/health/live`.
