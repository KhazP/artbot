import { describe, expect, it, vi } from "vitest";
import { AuthManager } from "@artbot/auth-manager";
import { BrowserClient, containsBlockedIndicators, didRenderedPaginationAdvance } from "./browser-client.js";

describe("BrowserClient retry policy", () => {
  it("stops retrying after maxAttempts", async () => {
    const client = new BrowserClient(new AuthManager([]));
    const task = vi.fn(async () => {
      throw new Error("transient failure");
    });

    await expect(client.withRetries(task, 3, 1)).rejects.toThrow("transient failure");
    expect(task).toHaveBeenCalledTimes(3);
  });
});

describe("containsBlockedIndicators", () => {
  it("does not mark plain reCAPTCHA script pages as blocked", () => {
    const html = `
      <html>
        <head>
          <script src="https://www.gstatic.com/recaptcha/releases/foo/recaptcha__en.js"></script>
        </head>
        <body>
          <h1>Gallery Home</h1>
          <div class="grecaptcha-badge">protected by reCAPTCHA</div>
        </body>
      </html>
    `;

    expect(containsBlockedIndicators(html)).toBe(false);
  });

  it("marks cloudflare challenge pages as blocked", () => {
    const html = `
      <html>
        <head><title>Just a moment...</title></head>
        <body>
          <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>
          <noscript><span>Enable JavaScript and cookies to continue</span></noscript>
        </body>
      </html>
    `;

    expect(containsBlockedIndicators(html)).toBe(true);
  });
});

describe("didRenderedPaginationAdvance", () => {
  it("treats same-url load-more expansion as progress", () => {
    expect(
      didRenderedPaginationAdvance(
        {
          url: "https://example.com/search",
          anchorCount: 20,
          imageCount: 8,
          itemCount: 12,
          textLength: 3200
        },
        {
          url: "https://example.com/search",
          anchorCount: 38,
          imageCount: 16,
          itemCount: 24,
          textLength: 6100
        }
      )
    ).toBe(true);
  });

  it("does not treat an unchanged same-url page as progress", () => {
    expect(
      didRenderedPaginationAdvance(
        {
          url: "https://example.com/search",
          anchorCount: 20,
          imageCount: 8,
          itemCount: 12,
          textLength: 3200
        },
        {
          url: "https://example.com/search",
          anchorCount: 20,
          imageCount: 8,
          itemCount: 12,
          textLength: 3205
        }
      )
    ).toBe(false);
  });
});
