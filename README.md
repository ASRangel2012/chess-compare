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
- `GET /api/health` — health check for Docker

The Anthropic API key stays server-side and is never exposed to the browser. `/api/analyze` is rate limited (10 requests/min per IP, in-memory) so a public deployment can't be abused to burn your API budget.

In **development**, Vite runs on `:5173` and proxies `/api` → Express on `:3001`.
In **production/Docker**, a single Express process serves both the static React build and the API on `:3001`.

## Features

- Player profiles & rating comparison (bullet, blitz, rapid, daily)
- Opening analysis from recent PGN data
- **Head-to-head history** — scans monthly archives for direct matchups
- **Inline game replay** — step through any head-to-head game on a board, powered by a small dependency-free PGN/SAN engine (`src/lib/chess.ts`)
- Game length distribution
- AI play style profiles via Claude

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
| `ANTHROPIC_MAX_TOKENS` | No | `4096` | Upper bound on the model's reply. The analysis is one JSON object (two profiles, a matchup, and a detailed game plan); verbose models like Sonnet need enough room or the JSON is truncated and won't parse (`502`). |
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

## IntelliJ IDEA / WebStorm

The project includes shared run configurations in `.run/` and a WEB module in `.idea/`.

### One-time setup

1. **Open the project** — File → Open → select the `chess-compare` folder.
2. **Node.js** — Settings → Languages & Frameworks → Node.js  
   Set the interpreter to your local Node 20+ install (or let IntelliJ download one).
3. **Install dependencies** — open the built-in terminal and run:
   ```bash
   npm install
   ```
4. **Environment** — copy `.env.example` to `.env` and add your `ANTHROPIC_API_KEY`.  
   The API server loads this automatically via `dotenv`.

### Run configurations (top-right dropdown)

| Configuration | What it does |
|---------------|--------------|
| **Chess Compare - Dev (Compound)** *(default)* | Starts API server (`:3001`) and Vite (`:5173`) in separate run tabs |
| **Chess Compare - Dev** | Single process via `concurrently` |
| **Dev Server (API)** | Express/Claude proxy only |
| **Dev Client (Vite)** | React frontend only (needs API running separately) |
| **Production** | `npm run build` then serves UI + API on `:3001` |

Use **Chess Compare - Dev (Compound)**, then open [http://localhost:5173](http://localhost:5173).

TypeScript is split across `tsconfig.app.json` (React `src/`) and `tsconfig.node.json` (`server/` + Vite config) so IntelliJ resolves both correctly.

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
| `npm test` | Run the Vitest unit suite |
| `npm run test:watch` | Run Vitest in watch mode |

## Testing & CI

Unit tests live next to the code they cover (`src/lib/*.test.ts`, `server/*.test.ts`) and run on [Vitest](https://vitest.dev):

```bash
npm test
```

They cover:

- **Pure data layer** — PGN parsing (`deriveTimeClass`, `normalizeResult`, opening-name resolution), per-player aggregation, and head-to-head summarization.
- **Chess engine** (`chess.ts`) — replaying famous games move-by-move, including castling, en passant, promotion, explicit disambiguation, and the implicit *disambiguation-by-pin* case (king-safety fallback).
- **Network layer** — a mocked-`fetch` test that verifies the archive fetcher's concurrency limit, caching, early-stop, and newest-first ordering.
- **Comparison orchestration** (`compare.ts`) — `Promise.allSettled` profile resolution and precise error mapping, tested with injected fakes (no network, no DOM).
- **Server** (`analyze.ts`, `rateLimit.ts`, `app.ts`) — request validation, model-output parsing/shape-validation, the rate limiter, and the `/api/analyze` endpoint end-to-end with an injected Claude stub (503 / 400 / 429 / 502 / 200 paths).

`.github/workflows/ci.yml` runs type-che