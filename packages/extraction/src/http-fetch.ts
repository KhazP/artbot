import { load } from "cheerio";
import { execFile } from "node:child_process";

export interface FetchResult {
  url: string;
  html: string;
  markdown: string;
  status: number;
  parserUsed: string;
}

export interface SessionContext {
  sessionId?: string;
  proxyUrl?: string;
  attemptCount: number;
}

export enum TransportErrorKind {
  DNS_FAILED = "DNS_FAILED",
  TCP_TIMEOUT = "TCP_TIMEOUT",
  TCP_REFUSED = "TCP_REFUSED",
  TLS_FAILED = "TLS_FAILED",
  RATE_LIMITED = "RATE_LIMITED",
  WAF_BLOCK = "WAF_BLOCK",
  AUTH_INVALID = "AUTH_INVALID",
  LEGAL_BLOCK = "LEGAL_BLOCK",
  HTTP_ERROR = "HTTP_ERROR",
  UNKNOWN_NETWORK = "UNKNOWN_NETWORK"
}

export interface TransportProviderResult {
  url: string;
  status: number;
  html: string;
  provider: string;
}

export interface TransportProvider {
  readonly name: string;
  request(url: string, sessionContext: SessionContext, timeoutMs: number): Promise<TransportProviderResult>;
}

export class TransportError extends Error {
  constructor(
    readonly kind: TransportErrorKind,
    message: string,
    readonly provider: string,
    readonly host?: string,
    readonly statusCode?: number,
    readonly retryable: boolean = false,
    readonly cause?: unknown
  ) {
    super(message);
  }
}

interface HttpIssue {
  kind: TransportErrorKind;
  retryable: boolean;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CURL_META_MARKER = "__ARTBOT_CURL_META__";

function htmlToMarkdownLikeText(html: string): string {
  const $ = load(html);
  $("script, style, noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function toHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function classifyHttpIssue(status: number, html: string): HttpIssue | null {
  if (status === 429) {
    return { kind: TransportErrorKind.RATE_LIMITED, retryable: true };
  }

  if (status === 401 || status === 407) {
    return { kind: TransportErrorKind.AUTH_INVALID, retryable: false };
  }

  if (status === 451) {
    return { kind: TransportErrorKind.LEGAL_BLOCK, retryable: false };
  }

  if (status === 403) {
    const lower = html.toLowerCase();
    if (
      lower.includes("captcha") ||
      lower.includes("cloudflare") ||
      lower.includes("access denied") ||
      lower.includes("attention required")
    ) {
      return { kind: TransportErrorKind.WAF_BLOCK, retryable: false };
    }
  }

  if (status >= 400) {
    return { kind: TransportErrorKind.HTTP_ERROR, retryable: status >= 500 };
  }

  return null;
}

function classifyNodeError(url: string, provider: string, error: unknown): TransportError {
  if (error instanceof TransportError) {
    return error;
  }

  const host = toHost(url);
  const cause = (error as { cause?: { code?: string } })?.cause;
  const code = (cause?.code ?? (error as { code?: string })?.code ?? "").toUpperCase();

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new TransportError(
      TransportErrorKind.DNS_FAILED,
      `DNS lookup failed for ${host ?? "unknown host"}.`,
      provider,
      host,
      undefined,
      true,
      error
    );
  }

  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ABORT_ERR") {
    return new TransportError(
      TransportErrorKind.TCP_TIMEOUT,
      `Connection timed out for ${host ?? "unknown host"}.`,
      provider,
      host,
      undefined,
      true,
      error
    );
  }

  if (code === "ECONNREFUSED") {
    return new TransportError(
      TransportErrorKind.TCP_REFUSED,
      `Connection refused for ${host ?? "unknown host"}.`,
      provider,
      host,
      undefined,
      true,
      error
    );
  }

  if (code.startsWith("ERR_TLS") || code.startsWith("CERT_") || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return new TransportError(
      TransportErrorKind.TLS_FAILED,
      `TLS handshake failed for ${host ?? "unknown host"}.`,
      provider,
      host,
      undefined,
      false,
      error
    );
  }

  return new TransportError(
    TransportErrorKind.UNKNOWN_NETWORK,
    `Network request failed for ${host ?? "unknown host"}.`,
    provider,
    host,
    undefined,
    true,
    error
  );
}

function classifyCurlExit(url: string, code: number, stderr: string): TransportError {
  const host = toHost(url);

  if (code === 6) {
    return new TransportError(
      TransportErrorKind.DNS_FAILED,
      `DNS lookup failed for ${host ?? "unknown host"}.`,
      "curl",
      host,
      undefined,
      true,
      stderr
    );
  }

  if (code === 7) {
    return new TransportError(
      TransportErrorKind.TCP_REFUSED,
      `Connection refused for ${host ?? "unknown host"}.`,
      "curl",
      host,
      undefined,
      true,
      stderr
    );
  }

  if (code === 28) {
    return new TransportError(
      TransportErrorKind.TCP_TIMEOUT,
      `Connection timed out for ${host ?? "unknown host"}.`,
      "curl",
      host,
      undefined,
      true,
      stderr
    );
  }

  if (code === 35 || code === 51 || code === 60) {
    return new TransportError(
      TransportErrorKind.TLS_FAILED,
      `TLS handshake failed for ${host ?? "unknown host"}.`,
      "curl",
      host,
      undefined,
      false,
      stderr
    );
  }

  return new TransportError(
    TransportErrorKind.UNKNOWN_NETWORK,
    `Network request failed for ${host ?? "unknown host"} (curl exit ${code}).`,
    "curl",
    host,
    undefined,
    true,
    stderr
  );
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === "true";
}

function computeBackoffMs(attempt: number): number {
  const jitter = Math.floor(Math.random() * 120);
  return 250 * 2 ** Math.max(0, attempt - 1) + jitter;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransportError(value: unknown): value is TransportError {
  return value instanceof TransportError;
}

function canFallbackToCurl(error: TransportError): boolean {
  return (
    error.kind === TransportErrorKind.DNS_FAILED ||
    error.kind === TransportErrorKind.TCP_TIMEOUT ||
    error.kind === TransportErrorKind.TCP_REFUSED ||
    error.kind === TransportErrorKind.TLS_FAILED ||
    error.kind === TransportErrorKind.UNKNOWN_NETWORK
  );
}

export class NodeFetchProvider implements TransportProvider {
  readonly name = "node_fetch";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async request(url: string, _sessionContext: SessionContext, timeoutMs: number): Promise<TransportProviderResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT
        }
      });
      const html = await response.text();
      const issue = classifyHttpIssue(response.status, html);
      if (issue) {
        throw new TransportError(
          issue.kind,
          `HTTP ${response.status} from ${toHost(response.url) ?? "unknown host"}.`,
          this.name,
          toHost(response.url),
          response.status,
          issue.retryable
        );
      }

      return {
        url: response.url,
        status: response.status,
        html,
        provider: this.name
      };
    } catch (error) {
      throw classifyNodeError(url, this.name, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class CurlProvider implements TransportProvider {
  readonly name = "curl";

  async request(url: string, sessionContext: SessionContext, timeoutMs: number): Promise<TransportProviderResult> {
    const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const args = [
      "-sS",
      "-L",
      "--max-time",
      String(timeoutSeconds),
      "-A",
      USER_AGENT,
      url,
      "-w",
      `\n${CURL_META_MARKER}%{http_code}|%{url_effective}`
    ];

    if (sessionContext.proxyUrl) {
      args.unshift(sessionContext.proxyUrl);
      args.unshift("--proxy");
    }

    const output = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile("curl", args, { maxBuffer: 12 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject({
            exitCode: typeof error.code === "number" ? error.code : 1,
            stderr: String(stderr)
          });
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      });
    }).catch((error: { exitCode: number; stderr: string }) => {
      throw classifyCurlExit(url, error.exitCode, error.stderr);
    });

    const markerIndex = output.stdout.lastIndexOf(CURL_META_MARKER);
    if (markerIndex === -1) {
      throw new TransportError(
        TransportErrorKind.UNKNOWN_NETWORK,
        `Curl response metadata missing for ${toHost(url) ?? "unknown host"}.`,
        this.name,
        toHost(url),
        undefined,
        true,
        output.stderr
      );
    }

    const body = output.stdout.slice(0, markerIndex).trimEnd();
    const meta = output.stdout.slice(markerIndex + CURL_META_MARKER.length).trim();
    const [statusRaw, effectiveUrlRaw] = meta.split("|");
    const status = Number(statusRaw);
    const effectiveUrl = effectiveUrlRaw || url;
    const issue = classifyHttpIssue(status, body);
    if (issue) {
      throw new TransportError(
        issue.kind,
        `HTTP ${status} from ${toHost(effectiveUrl) ?? "unknown host"}.`,
        this.name,
        toHost(effectiveUrl),
        status,
        issue.retryable
      );
    }

    return {
      url: effectiveUrl,
      status,
      html: body,
      provider: this.name
    };
  }
}

export async function fetchPage(url: string, sessionContext?: Partial<SessionContext>): Promise<FetchResult> {
  const maxAttempts = Math.max(1, Number(process.env.TRANSPORT_MAX_ATTEMPTS ?? 3));
  const timeoutMs = Math.max(1_000, Number(process.env.TRANSPORT_REQUEST_TIMEOUT_MS ?? 15_000));
  const curlFallback = parseBooleanEnv(process.env.TRANSPORT_CURL_FALLBACK, true);

  const nodeProvider = new NodeFetchProvider();
  const curlProvider = new CurlProvider();
  let lastError: TransportError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const context: SessionContext = {
      sessionId: sessionContext?.sessionId,
      proxyUrl: sessionContext?.proxyUrl,
      attemptCount: attempt
    };

    try {
      const primary = await nodeProvider.request(url, context, timeoutMs);
      return {
        url: primary.url,
        html: primary.html,
        markdown: htmlToMarkdownLikeText(primary.html),
        status: primary.status,
        parserUsed: "http-fetch"
      };
    } catch (error) {
      const classified = isTransportError(error) ? error : classifyNodeError(url, nodeProvider.name, error);
      lastError = classified;

      if (curlFallback && canFallbackToCurl(classified)) {
        try {
          const fallback = await curlProvider.request(url, context, timeoutMs);
          return {
            url: fallback.url,
            html: fallback.html,
            markdown: htmlToMarkdownLikeText(fallback.html),
            status: fallback.status,
            parserUsed: "http-fetch"
          };
        } catch (fallbackError) {
          lastError = isTransportError(fallbackError)
            ? fallbackError
            : new TransportError(
                TransportErrorKind.UNKNOWN_NETWORK,
                `Fallback transport failed for ${toHost(url) ?? "unknown host"}.`,
                curlProvider.name,
                toHost(url),
                undefined,
                true,
                fallbackError
              );
        }
      }

      if (!lastError.retryable || attempt >= maxAttempts) {
        throw lastError;
      }
    }

    await wait(computeBackoffMs(attempt));
  }

  throw (
    lastError ??
    new TransportError(
      TransportErrorKind.UNKNOWN_NETWORK,
      `Network request failed for ${toHost(url) ?? "unknown host"}.`,
      "node_fetch",
      toHost(url),
      undefined,
      true
    )
  );
}
