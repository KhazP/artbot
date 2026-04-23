import { describe, expect, it, vi } from "vitest";
import { AuthManager } from "@artbot/auth-manager";
import {
  BrowserClient,
  containsAuthIndicators,
  containsBlockedIndicators,
  didRenderedPaginationAdvance,
  extractInlineScriptDiscoveredUrls,
  resolveStagehandRuntimeConfig,
  shouldPersistHeavyBrowserArtifacts
} from "./browser-client.js";

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

  it("does not mark normal reCAPTCHA pages as blocked just because cloudflare is mentioned", () => {
    const html = `
      <html>
        <head>
          <script src="https://www.gstatic.com/recaptcha/releases/foo/recaptcha__en.js"></script>
        </head>
        <body>
          <div class="grecaptcha-badge">protected by reCAPTCHA</div>
          <footer>cdn provider: cloudflare</footer>
          <h3><a href="https://sanatfiyat.com/search/artist-detail/95/">Abidin Dino</a></h3>
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

describe("containsAuthIndicators", () => {
  it("marks hard-gated member-only content as auth-gated", () => {
    const html = `
      <html>
        <body>
          <div class="modal-body">
            <p>Bu sayfada yer alan özel içerik sadece sanatfiyat.com üyeleri tarafından görüntülenebilmektedir.</p>
            <p>Üyelik paketlerimizi görmek ve üye olmak için tıklayınız.</p>
          </div>
          <a href="https://sanatfiyat.com/artist/login">OTURUM AÇ</a>
          <a href="https://sanatfiyat.com/artist/register">ÜYE OL</a>
        </body>
      </html>
    `;

    expect(containsAuthIndicators(html)).toBe(true);
  });

  it("does not mark pages as auth-gated just because they have generic login links", () => {
    const html = `
      <html>
        <body>
          <nav>
            <a href="/login">Sign in</a>
            <a href="/register">Register</a>
          </nav>
          <h1>Gallery Home</h1>
        </body>
      </html>
    `;

    expect(containsAuthIndicators(html)).toBe(false);
  });
});

describe("extractInlineScriptDiscoveredUrls", () => {
  it("captures Sanatfiyat-style autocomplete URLs embedded in inline scripts", () => {
    const html = `
      <html>
        <body>
          <script>
            const artists = [
              { value: "Abidin Dino", url: "https://sanatfiyat.com/artist/artist-detail/95/abidin-dino", label: "Abidin Dino" },
              { value: "Ahmet Piriştina", url: "https://sanatfiyat.com/artist/artist-detail/1/ahmet-piristina", label: "Ahmet Piriştina" }
            ];
          </script>
        </body>
      </html>
    `;

    expect(extractInlineScriptDiscoveredUrls(html, "https://sanatfiyat.com/artist?q=Abidin%20Dino")).toContain(
      "https://sanatfiyat.com/artist/artist-detail/95/abidin-dino"
    );
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

describe("shouldPersistHeavyBrowserArtifacts", () => {
  it("returns false when heavy evidence is disabled or artifacts are restricted", () => {
    expect(shouldPersistHeavyBrowserArtifacts(false, "standard")).toBe(false);
    expect(shouldPersistHeavyBrowserArtifacts(true, "internal_only")).toBe(false);
    expect(shouldPersistHeavyBrowserArtifacts(true, "scrubbed_sensitive")).toBe(false);
  });

  it("returns true only for standard artifact handling with heavy evidence enabled", () => {
    expect(shouldPersistHeavyBrowserArtifacts(true, "standard")).toBe(true);
  });
});

describe("resolveStagehandRuntimeConfig", () => {
  it("keeps stagehand disabled by default", () => {
    expect(resolveStagehandRuntimeConfig({})).toEqual({
      enabled: false,
      mode: "DISABLED"
    });
  });

  it("supports local stagehand without Browserbase credentials", () => {
    expect(
      resolveStagehandRuntimeConfig({
        STAGEHAND_MODE: "LOCAL",
        LLM_BASE_URL: "https://integrate.api.nvidia.com/v1",
        LLM_API_KEY: "nvidia-key",
        LLM_MODEL: "minimaxai/minimax-m2.7"
      })
    ).toEqual({
      enabled: true,
      mode: "LOCAL",
      config: {
        env: "LOCAL",
        modelName: "minimaxai/minimax-m2.7",
        verbose: 0,
        modelClientOptions: {
          apiKey: "nvidia-key",
          baseURL: "https://integrate.api.nvidia.com/v1"
        }
      }
    });
  });

  it("requires Browserbase credentials in browserbase mode", () => {
    expect(
      resolveStagehandRuntimeConfig({
        STAGEHAND_MODE: "BROWSERBASE"
      })
    ).toEqual({
      enabled: false,
      mode: "BROWSERBASE",
      reason: "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required for STAGEHAND_MODE=BROWSERBASE."
    });
  });

  it("falls back cleanly when local mode is missing its LLM endpoint", () => {
    expect(
      resolveStagehandRuntimeConfig({
        STAGEHAND_MODE: "LOCAL",
        LLM_MODEL: "minimaxai/minimax-m2.7"
      })
    ).toEqual({
      enabled: false,
      mode: "LOCAL",
      reason: "LLM_BASE_URL is required for STAGEHAND_MODE=LOCAL."
    });
  });
});
