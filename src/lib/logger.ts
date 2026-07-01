/**
 * Minimal client logger. Centralizes the one seam where we'd wire real
 * telemetry (Sentry, a logging endpoint, etc.) later. For now it wraps the
 * console with a consistent prefix and drops `debug` in production builds so
 * best-effort paths (a failed head-to-head scan) are visible while developing
 * without being noisy in prod.
 */

type Level = "debug" | "info" | "warn" | "error";

const isDev = import.meta.env.DEV;

function emit(level: Level, msg: string, detail?: unknown) {
  if (level === "debug" && !isDev) return;
  const label = `[chess-compare] ${msg}`;
  const fn =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "debug"
          ? console.debug
          : console.info;
  if (detail !== undefined) fn(label, detail);
  else fn(label);
}

export const logger = {
  debug: (msg: string, detail?: unknown) => emit("debug", msg, detail),
  info: (msg: string, detail?: unknown) => emit("info", msg, detail),
  warn: (msg: string, detail?: unknown) => emit("warn", msg, detail),
  error: (msg: string, detail?: unknown) => emit("error", msg, detail),
};
