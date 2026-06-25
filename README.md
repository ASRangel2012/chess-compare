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
- `POST /api/analyze` — sends aggregated game stats to Claude and returns play-style profiles
- `GET /api/health` — health check for Docker

In **development**, Vite runs on `:5173` and proxies `/api` → Express on `:3001`.
In **production/Docker**, a single Express process serves both the static React build and the API on `:3001`.

## Features

- Player profiles & rating comparison (bullet, blitz, rapid, daily)
- Opening analysis from recent PGN data
- **Head-to-head history** — scans monthly archives for direct matchups
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

Open [http://localhost:5173](http://localhost:5173).

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

## Head-to-head

Chess.com has no dedicated H2H endpoint. The app scans the last 48 months of Player 1's game archives and filters games where the opponent is Player 2.

## Theming

CSS variables only (`--color-background-*`, `--color-text-*`, `--color-success`, `--color-danger`). Auto light/dark via `prefers-color-scheme` with manual toggle.
