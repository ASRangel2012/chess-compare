// Dev launcher: pick a free API port (starting at PORT or 3001) BEFORE starting
// anything, then start the API and the Vite client with that port in the env.
// Both the server (app.listen) and the Vite proxy read process.env.PORT, so they
// always agree — even if the default port was busy.
import { createServer } from "node:net";
import { spawn } from "node:child_process";

const BASE_PORT = Number(process.env.PORT) || 3001;
const MAX_ATTEMPTS = 10;

/** Resolve true if `port` can be bound (i.e. it's free). */
function isFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

let port = BASE_PORT;
let found = false;
for (let i = 0; i < MAX_ATTEMPTS; i++, port++) {
  if (await isFree(port)) {
    found = true;
    break;
  }
}

if (!found) {
  console.error(
    `Could not find a free port in ${BASE_PORT}-${BASE_PORT + MAX_ATTEMPTS - 1}. ` +
      `Free one up and try again.`
  );
  process.exit(1);
}

if (port !== BASE_PORT) {
  console.log(
    `\n⚠  Port ${BASE_PORT} is in use — using ${port} for the API instead.` +
      `\n   The Vite proxy targets the same port automatically; open http://localhost:5173 as usual.\n`
  );
}

const child = spawn("npm", ["run", "dev:concurrent"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, PORT: String(port) },
});

child.on("exit", (code) => process.exit(code ?? 0));
