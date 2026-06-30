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
| `PORT` | No | `3001` | API port. The dev launcher auto-selects the next free port if this is taken; the Vite proxy follows it. |

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
cp .env .env
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

Unit tests live next to the code they cover (`src/lib/*.test.ts`) and run on [Vitest](https://vitest.dev):

```bash
npm test
```

They cover the pure data layer — PGN parsing (`deriveTimeClass`, `normalizeResult`, opening-name resolution), per-player aggregation, and head-to-head summarization — plus a mocked-`fetch` test that verifies the archive fetcher's concurrency limit, caching, early-stop, and newest-first ordering.

`.github/workflows/ci.yml` runs type-check → tests → production build on every push and pull request.

## Network layer

Chess.com archives are fetched with bounded concurrency (6 in flight) rather than serially, with in-memory caching of the immutable archives list and completed months, a 15s per-request timeout, and bounded retry/back-off on HTTP 429.

## Head-to-head

Chess.com has no dedicated H2H endpoint. The app scans the last 48 months of Player 1's game archives and filters games where the opponent is Player 2 (standard chess only — chess960 and other variants are excluded). Opening names come from the PGN `ECOUrl` (Chess.com PGNs carry no `Opening` tag), and game format falls back to the PGN `TimeControl` when `time_class` is absent.

## Theming

CSS variables only (`--color-background-*`, `--color-text-*`, `--color-success`, `--color-danger`). Auto light/dark via `prefers-color-scheme`, with a manual toggle that sets `data-theme` on `<html>` so the entire page (including the body background) switches.
