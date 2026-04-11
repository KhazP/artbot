import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args)
}));

import { NodeFetchProvider, TransportErrorKind, fetchPage, isTransportError } from "./http-fetch.js";

const originalFetch = global.fetch;
const originalEnv = {
  TRANSPORT_MAX_ATTEMPTS: process.env.TRANSPORT_MAX_ATTEMPTS,
  TRANSPORT_REQUEST_TIMEOUT_MS: process.env.TRANSPORT_REQUEST_TIMEOUT_MS,
  TRANSPORT_CURL_FALLBACK: process.env.TRANSPORT_CURL_FALLBACK
};

function dnsError(): TypeError {
  const error = new TypeError("fetch failed");
  (error as TypeError & { cause?: { code: string } }).cause = { code: "ENOTFOUND" };
  return error;
}

function timeoutError(): TypeError {
  const error = new TypeError("fetch failed");
  (error as TypeError & { cause?: { code: string } }).cause = { code: "ETIMEDOUT" };
  return error;
}

describe("http transport", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    process.env.TRANSPORT_MAX_ATTEMPTS = "1";
    process.env.TRANSPORT_REQUEST_TIMEOUT_MS = "2000";
    process.env.TRANSPORT_CURL_FALLBACK = "true";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.TRANSPORT_MAX_ATTEMPTS = originalEnv.TRANSPORT_MAX_ATTEMPTS;
    process.env.TRANSPORT_REQUEST_TIMEOUT_MS = originalEnv.TRANSPORT_REQUEST_TIMEOUT_MS;
    process.env.TRANSPORT_CURL_FALLBACK = originalEnv.TRANSPORT_CURL_FALLBACK;
  });

  it("returns payload when node fetch succeeds", async () => {
    const provider = new NodeFetchProvider(
      vi.fn(async () => new Response("<html><body>hello</body></html>", { status: 200 }))
    );

    const result = await provider.request("https://example.com", { attemptCount: 1 }, 2_000);
    expect(result.status).toBe(200);
    expect(result.html).toContain("hello");
  });

  it("classifies DNS failures from node fetch", async () => {
    const provider = new NodeFetchProvider(vi.fn(async () => Promise.reject(dnsError())));

    await expect(provider.request("https://example.com", { attemptCount: 1 }, 2_000)).rejects.toMatchObject({
      kind: TransportErrorKind.DNS_FAILED
    });
  });

  it("falls back to curl when node fetch has network failure", async () => {
    global.fetch = vi.fn(async () => Promise.reject(dnsError())) as typeof fetch;
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _opts: { maxBuffer: number },
        cb: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        cb(null, "<html><body>ok</body></html>\n__ARTBOT_CURL_META__200|https://example.com", "");
      }
    );

    const result = await fetchPage("https://example.com", { attemptCount: 1 });
    expect(result.status).toBe(200);
    expect(result.html).toContain("ok");
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("does not fallback to curl for rate-limit HTTP errors", async () => {
    global.fetch = vi.fn(async () => new Response("too many requests", { status: 429 })) as typeof fetch;

    await expect(fetchPage("https://example.com", { attemptCount: 1 })).rejects.toMatchObject({
      kind: TransportErrorKind.RATE_LIMITED
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("maps HTTP 451 to LEGAL_BLOCK", async () => {
    global.fetch = vi.fn(async () => new Response("Unavailable for legal reasons", { status: 451 })) as typeof fetch;

    await expect(fetchPage("https://example.com", { attemptCount: 1 })).rejects.toMatchObject({
      kind: TransportErrorKind.LEGAL_BLOCK
    });
  });

  it("retries transient transport errors up to configured limit", async () => {
    process.env.TRANSPORT_MAX_ATTEMPTS = "2";
    process.env.TRANSPORT_CURL_FALLBACK = "false";
    const fetchMock = vi.fn(async () => Promise.reject(timeoutError()));
    global.fetch = fetchMock as typeof fetch;

    await expect(fetchPage("https://example.com", { attemptCount: 1 })).rejects.toSatisfy((error: unknown) => {
      return isTransportError(error) && error.kind === TransportErrorKind.TCP_TIMEOUT;
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
