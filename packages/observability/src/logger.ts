export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  traceId?: string;
  runId?: string;
  stage?: string;
  source?: string;
  [key: string]: unknown;
}

const SENSITIVE_KEYS = ["password", "token", "apikey", "api_key", "authorization", "cookie", "secret"];

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const lower = k.toLowerCase();
      out[k] = SENSITIVE_KEYS.some((token) => lower.includes(token)) ? "***redacted***" : redactValue(v);
    }
    return out;
  }
  return value;
}

function sanitizeContext(context: LogContext): Record<string, unknown> {
  return redactValue(context) as Record<string, unknown>;
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...sanitizeContext(context)
  };
   
  console.log(JSON.stringify(payload));
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context)
};

export function createTraceId(prefix = "trace"): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${random}`;
}
