/**
 * Tiny dependency-free structured logger.
 *
 * Emits one JSON object per line (`{ ts, level, msg, ...meta }`) so logs are
 * greppable locally and ingestible by a log aggregator in production, without
 * pulling in winston/pino. Levels are gated by `LOG_LEVEL` (default `info`);
 * `error`/`warn` go to stderr, everything else to stdout.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveThreshold(): number {
  const configured = process.env.LOG_LEVEL as LogLevel | undefined;
  return configured && configured in LEVEL_WEIGHT
    ? LEVEL_WEIGHT[configured]
    : LEVEL_WEIGHT.info;
}

/** Serialize an unknown thrown value into something safe to log. */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

/** Build the log record. Exposed for unit tests. */
export function formatRecord(
  level: LogLevel,
  msg: string,
  meta?: Record<string, unknown>
): Record<string, unknown> {
  return { ts: new Date().toISOString(), level, msg, ...meta };
}

function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  if (LEVEL_WEIGHT[level] < resolveThreshold()) return;
  const line = JSON.stringify(formatRecord(level, msg, meta));
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  /** Return a logger that stamps `bindings` (e.g. a requestId) onto every line. */
  child(bindings: Record<string, unknown>): Logger;
}

function make(bindings: Record<string, unknown>): Logger {
  const withBindings = (meta?: Record<string, unknown>) => ({ ...bindings, ...meta });
  return {
    debug: (msg, meta) => emit("debug", msg, withBindings(meta)),
    info: (msg, meta) => emit("info", msg, withBindings(meta)),
    warn: (msg, meta) => emit("warn", msg, withBindings(meta)),
    error: (msg, meta) => emit("error", msg, withBindings(meta)),
    child: (extra) => make({ ...bindings, ...extra }),
  };
}

export const logger: Logger = make({});
