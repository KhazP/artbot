import fs from "node:fs";
import path from "node:path";
import { AuthManager } from "@artbot/auth-manager";
import { logger } from "@artbot/observability";
import type { AccessContext } from "@artbot/shared-types";
import { chromium, type BrowserContext, type Page } from "playwright";

export interface BrowserCaptureInput {
  traceId: string;
  sourceName: string;
  url: string;
  runId: string;
  evidenceDir: string;
  accessContext: AccessContext;
  timeoutMs?: number;
  captureHeavyEvidence?: boolean;
}

export interface BrowserCaptureResult {
  finalUrl: string;
  screenshotPath: string | null;
  preAuthScreenshotPath: string | null;
  postAuthScreenshotPath: string | null;
  rawSnapshotPath: string | null;
  tracePath: string | null;
  harPath: string | null;
  requiresAuthDetected: boolean;
  blockedDetected: boolean;
  modelUsed: string | null;
}

export interface BrowserDiscoveryInput extends BrowserCaptureInput {
  maxPages?: number;
  maxLinks?: number;
}

export interface BrowserDiscoveryResult {
  finalUrl: string;
  screenshotPaths: string[];
  rawSnapshotPaths: string[];
  discoveredUrls: string[];
  discoveredImageUrls: string[];
  pageCount: number;
  requiresAuthDetected: boolean;
  blockedDetected: boolean;
}

export interface RenderedPageProgressSnapshot {
  url: string;
  anchorCount: number;
  imageCount: number;
  itemCount: number;
  textLength: number;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const NAVIGATION_SETTLE_MS = 1_500;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeRenderedDiscoveryUrl(value: string | null | undefined, baseUrl: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (
    !trimmed
    || trimmed.startsWith("javascript:")
    || trimmed.startsWith("mailto:")
    || trimmed.startsWith("tel:")
    || trimmed.startsWith("#")
  ) {
    return null;
  }
  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (
        lower.startsWith("utm_")
        || lower === "gclid"
        || lower === "fbclid"
        || lower === "ref"
        || lower === "_pos"
        || lower === "_sid"
        || lower === "_ss"
      ) {
        url.searchParams.delete(key);
      }
    }
    const pathname = url.pathname.toLowerCase();
    if (
      pathname.endsWith(".oembed")
      || /\.(?:css|js|json|xml|pdf|zip|mp3|mp4|ico)$/i.test(pathname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function extractInlineScriptDiscoveredUrls(content: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const httpUrlRegex = /https?:\/\/[^\s"'`<>\\]+/gi;
  let scriptMatch: RegExpExecArray | null = scriptRegex.exec(content);
  while (scriptMatch) {
    const scriptContent = scriptMatch[1] ?? "";
    const matches = scriptContent.match(httpUrlRegex) ?? [];
    for (const match of matches) {
      const normalized = normalizeRenderedDiscoveryUrl(match, baseUrl);
      if (normalized) {
        urls.add(normalized);
      }
    }
    scriptMatch = scriptRegex.exec(content);
  }
  return [...urls];
}

export function containsAuthIndicators(content: string): boolean {
  const lower = content.toLowerCase();

  const hardGateIndicators = [
    "subscribe to view",
    "only members can view",
    "authentication required",
    "please log in to continue",
    "özel içerik sadece",
    "üyelik paketlerimizi görmek",
    "sadece sanatfiyat.com üyeleri tarafından görüntülenebilmektedir",
    "yetersiz kredi",
    "insufficient credit"
  ];
  if (hardGateIndicators.some((token) => lower.includes(token))) {
    return true;
  }

  const hasPasswordField =
    /<input\b[^>]+type=["']password["']/i.test(content)
    || /<input\b[^>]+name=["']password["']/i.test(content);
  const hasAuthPrompt =
    /\b(?:sign in|log in|login|member login|oturum aç|giriş yap|giris yap)\b/i.test(content);

  return hasPasswordField && hasAuthPrompt;
}

export function containsBlockedIndicators(content: string): boolean {
  const lower = content.toLowerCase();

  const hardChallengePatterns = [
    /cdn-cgi\/challenge-platform/i,
    /__cf_chl_/i,
    /\bcf-ray\b/i,
    /just a moment\.\.\./i,
    /enable javascript and cookies to continue/i,
    /verify you are human/i,
    /attention required/i
  ];
  if (hardChallengePatterns.some((pattern) => pattern.test(content))) {
    return true;
  }

  if (/(access denied|request blocked|forbidden)/i.test(lower)) {
    return true;
  }

  // Do not treat standalone "captcha" mentions as a block. Many normal pages include reCAPTCHA scripts.
  if (lower.includes("captcha") && /(blocked|forbidden|verify you are human|security check)/i.test(lower)) {
    return true;
  }

  if (/\b(?:too many requests|status\s*code\s*:?\s*429|error\s*429|http\s*429)\b/i.test(lower)) {
    return true;
  }

  return false;
}

export function renderedPageProgressKey(snapshot: RenderedPageProgressSnapshot): string {
  return [
    snapshot.url,
    snapshot.anchorCount,
    snapshot.imageCount,
    snapshot.itemCount,
    snapshot.textLength
  ].join("|");
}

export function didRenderedPaginationAdvance(
  before: RenderedPageProgressSnapshot,
  after: RenderedPageProgressSnapshot
): boolean {
  if (after.url !== before.url) {
    return true;
  }

  return (
    after.anchorCount > before.anchorCount ||
    after.imageCount > before.imageCount ||
    after.itemCount > before.itemCount ||
    after.textLength > before.textLength + 120
  );
}

export class BrowserClient {
  constructor(private readonly authManager: AuthManager) {}

  private async navigateWithRecovery(
    page: Page,
    url: string,
    timeoutMs: number
  ): Promise<void> {
    await page.goto(url, { waitUntil: "commit", timeout: timeoutMs });
    await page.waitForLoadState("domcontentloaded", { timeout: Math.min(timeoutMs, 8_000) }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => undefined);
    await wait(NAVIGATION_SETTLE_MS);
  }

  public async capture(input: BrowserCaptureInput): Promise<BrowserCaptureResult> {
    if (this.shouldUseStagehand()) {
      const stagehandResult = await this.captureWithStagehand(input);
      if (stagehandResult) {
        return stagehandResult;
      }
    }

    const timeoutMs = input.timeoutMs ?? 45_000;
    const screenshotsDir = path.join(input.evidenceDir, "screenshots");
    const rawDir = path.join(input.evidenceDir, "raw");
    const traceDir = path.join(input.evidenceDir, "traces");
    const harDir = path.join(input.evidenceDir, "har");
    fs.mkdirSync(screenshotsDir, { recursive: true });
    fs.mkdirSync(rawDir, { recursive: true });
    fs.mkdirSync(traceDir, { recursive: true });
    fs.mkdirSync(harDir, { recursive: true });

    const stamp = Date.now();
    const screenshotPath = path.join(screenshotsDir, `${input.sourceName}-${stamp}.png`);
    const preAuthScreenshotPath = path.join(screenshotsDir, `${input.sourceName}-${stamp}-pre-auth.png`);
    const postAuthScreenshotPath = path.join(screenshotsDir, `${input.sourceName}-${stamp}-post-auth.png`);
    const rawSnapshotPath = path.join(rawDir, `${input.sourceName}-${stamp}.html`);
    const tracePath = path.join(traceDir, `${input.sourceName}-${stamp}.zip`);
    const harPath = path.join(harDir, `${input.sourceName}-${stamp}.har`);

    const sessionPath = this.authManager.ensureSessionDir(input.accessContext.profileId);
    const refreshDecision = this.authManager.shouldRefreshSession({
      profileId: input.accessContext.profileId,
      sessionPath
    });

    if (
      sessionPath
      && refreshDecision.refresh
      && refreshDecision.reason === "Authentication gate detected; force session refresh."
      && fs.existsSync(sessionPath)
    ) {
      fs.rmSync(sessionPath, { force: true });
    }

    const materializedSession = this.authManager.materializeSessionState(input.accessContext.profileId);
    const browser = await chromium.launch({ headless: true });
    let context: BrowserContext | null = null;
    let traceStarted = false;

    try {
      context = await this.newContext(
        browser,
        materializedSession.browserPath,
        input.captureHeavyEvidence ? harPath : undefined
      );
      await this.injectCookies(context, input.accessContext.profileId, input.accessContext.cookieFile);

      if (input.captureHeavyEvidence) {
        await context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: true
        });
        traceStarted = true;
      }

      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);

      logger.info("Opening browser page", {
        traceId: input.traceId,
        runId: input.runId,
        source: input.sourceName,
        stage: "browser_open",
        url: input.url,
        accessMode: input.accessContext.mode,
        sessionRefreshReason: refreshDecision.reason
      });

      await this.navigateWithRecovery(page, input.url, timeoutMs);

      const captureAuthCheckpoints =
        input.accessContext.mode !== "anonymous" || Boolean(input.accessContext.manualLoginCheckpoint);

      if (captureAuthCheckpoints) {
        await page.screenshot({ path: preAuthScreenshotPath, fullPage: true });
      }

      if (input.accessContext.manualLoginCheckpoint) {
        await wait(10_000);
      }

      if (captureAuthCheckpoints) {
        await page.screenshot({ path: postAuthScreenshotPath, fullPage: true });
      }

      await page.screenshot({ path: screenshotPath, fullPage: true });
      const html = await page.content();
      fs.writeFileSync(rawSnapshotPath, html, "utf-8");

      if (materializedSession.browserPath) {
        await context.storageState({ path: materializedSession.browserPath });
        this.authManager.persistSessionState(input.accessContext.profileId, materializedSession.browserPath);
      }

      if (input.captureHeavyEvidence) {
        await context.tracing.stop({ path: tracePath });
        traceStarted = false;
      }

      const finalUrl = page.url();
      const requiresAuthDetected = containsAuthIndicators(html);
      const blockedDetected = containsBlockedIndicators(html);

      return {
        finalUrl,
        screenshotPath,
        preAuthScreenshotPath: captureAuthCheckpoints ? preAuthScreenshotPath : null,
        postAuthScreenshotPath: captureAuthCheckpoints ? postAuthScreenshotPath : null,
        rawSnapshotPath,
        tracePath: input.captureHeavyEvidence ? tracePath : null,
        harPath: input.captureHeavyEvidence ? harPath : null,
        requiresAuthDetected,
        blockedDetected,
        modelUsed: null
      };
    } finally {
      materializedSession.cleanup();
      if (context) {
        if (input.captureHeavyEvidence && traceStarted) {
          try {
            await context.tracing.stop({ path: tracePath });
          } catch (error) {
            logger.warn("Failed to stop trace capture", {
              traceId: input.traceId,
              runId: input.runId,
              source: input.sourceName,
              stage: "browser_trace_stop",
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        try {
          await context.close();
        } catch (error) {
          logger.warn("Failed to close browser context", {
            traceId: input.traceId,
            runId: input.runId,
            source: input.sourceName,
            stage: "browser_close_context",
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      try {
        await browser.close();
      } catch (error) {
        logger.warn("Failed to close browser instance", {
          traceId: input.traceId,
          runId: input.runId,
          source: input.sourceName,
          stage: "browser_close_instance",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  public async withRetries<T>(
    task: () => Promise<T>,
    maxAttempts = 3,
    baseDelayMs = 1_500,
    traceId?: string
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        logger.warn("Browser task failed", {
          traceId,
          stage: "browser_retry",
          attempt,
          maxAttempts,
          error: error instanceof Error ? error.message : String(error)
        });

        if (attempt < maxAttempts) {
          await wait(baseDelayMs * attempt);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  public async discoverRenderedArtifacts(input: BrowserDiscoveryInput): Promise<BrowserDiscoveryResult> {
    const timeoutMs = input.timeoutMs ?? 45_000;
    const maxPages = Math.max(1, Math.min(input.maxPages ?? 4, 10));
    const maxLinks = Math.max(20, Math.min(input.maxLinks ?? 400, 2000));
    const screenshotsDir = path.join(input.evidenceDir, "screenshots");
    const rawDir = path.join(input.evidenceDir, "raw");
    fs.mkdirSync(screenshotsDir, { recursive: true });
    fs.mkdirSync(rawDir, { recursive: true });

    const sessionPath = this.authManager.ensureSessionDir(input.accessContext.profileId);
    const refreshDecision = this.authManager.shouldRefreshSession({
      profileId: input.accessContext.profileId,
      sessionPath
    });

    if (
      sessionPath
      && refreshDecision.refresh
      && refreshDecision.reason === "Authentication gate detected; force session refresh."
      && fs.existsSync(sessionPath)
    ) {
      fs.rmSync(sessionPath, { force: true });
    }

    const materializedSession = this.authManager.materializeSessionState(input.accessContext.profileId);
    const browser = await chromium.launch({ headless: true });
    let context: BrowserContext | null = null;

    try {
      context = await this.newContext(browser, materializedSession.browserPath);
      await this.injectCookies(context, input.accessContext.profileId, input.accessContext.cookieFile);

      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      await this.navigateWithRecovery(page, input.url, timeoutMs);

      const discoveredUrls = new Set<string>();
      const discoveredImageUrls = new Set<string>();
      const visitedPageStates = new Set<string>();
      const screenshotPaths: string[] = [];
      const rawSnapshotPaths: string[] = [];
      let requiresAuthDetected = false;
      let blockedDetected = false;

      for (let index = 0; index < maxPages; index += 1) {
        await this.scrollPage(page);

        const html = await page.content();
        const pageProgress = await this.captureRenderedPageProgress(page);
        const pageStateKey = renderedPageProgressKey(pageProgress);
        if (visitedPageStates.has(pageStateKey)) {
          break;
        }
        visitedPageStates.add(pageStateKey);

        requiresAuthDetected = requiresAuthDetected || containsAuthIndicators(html);
        blockedDetected = blockedDetected || containsBlockedIndicators(html);

        const stamp = `${Date.now()}-${index + 1}`;
        const baseName = `${slugify(input.sourceName)}-${stamp}`;
        const screenshotPath = path.join(screenshotsDir, `${baseName}-rendered.png`);
        const rawSnapshotPath = path.join(rawDir, `${baseName}-rendered.html`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        fs.writeFileSync(rawSnapshotPath, html, "utf-8");
        screenshotPaths.push(screenshotPath);
        rawSnapshotPaths.push(rawSnapshotPath);
        const inlineScriptUrls = extractInlineScriptDiscoveredUrls(html, page.url());

        const pageArtifacts = await page.evaluate(() => {
          const normalize = (value: string | null | undefined): string | null => {
            if (!value) return null;
            const trimmed = value.trim();
            if (
              !trimmed
              || trimmed.startsWith("javascript:")
              || trimmed.startsWith("mailto:")
              || trimmed.startsWith("tel:")
              || trimmed.startsWith("#")
            ) {
              return null;
            }
            try {
              const url = new URL(trimmed, window.location.href);
              if (url.protocol !== "http:" && url.protocol !== "https:") {
                return null;
              }
              url.hash = "";
              for (const key of [...url.searchParams.keys()]) {
                const lower = key.toLowerCase();
                if (
                  lower.startsWith("utm_")
                  || lower === "gclid"
                  || lower === "fbclid"
                  || lower === "ref"
                  || lower === "_pos"
                  || lower === "_sid"
                  || lower === "_ss"
                ) {
                  url.searchParams.delete(key);
                }
              }
              const pathname = url.pathname.toLowerCase();
              if (
                pathname.endsWith(".oembed")
                || /\.(?:css|js|json|xml|pdf|zip|mp3|mp4|ico)$/i.test(pathname)
              ) {
                return null;
              }
              return url.toString();
            } catch {
              return null;
            }
          };

          const urls = Array.from(document.querySelectorAll("a[href]"))
            .map((element) => normalize((element as HTMLAnchorElement).getAttribute("href")))
            .filter((value): value is string => Boolean(value));
          const images = Array.from(document.querySelectorAll("img[src]"))
            .map((element) => normalize((element as HTMLImageElement).getAttribute("src")))
            .filter((value): value is string => Boolean(value));
          const ogImage = normalize(
            document.querySelector("meta[property='og:image']")?.getAttribute("content") ?? undefined
          );

          return {
            urls,
            images: ogImage ? [ogImage, ...images] : images
          };
        });

        for (const url of pageArtifacts.urls) {
          if (discoveredUrls.size >= maxLinks) break;
          discoveredUrls.add(url);
        }
        for (const url of inlineScriptUrls) {
          if (discoveredUrls.size >= maxLinks) break;
          discoveredUrls.add(url);
        }
        for (const imageUrl of pageArtifacts.images) {
          discoveredImageUrls.add(imageUrl);
        }

        const moved = await this.followNextPage(page, pageProgress, timeoutMs);
        if (!moved) {
          break;
        }
      }

      if (materializedSession.browserPath) {
        await context.storageState({ path: materializedSession.browserPath });
        this.authManager.persistSessionState(input.accessContext.profileId, materializedSession.browserPath);
      }

      return {
        finalUrl: page.url(),
        screenshotPaths,
        rawSnapshotPaths,
        discoveredUrls: [...discoveredUrls],
        discoveredImageUrls: [...discoveredImageUrls],
        pageCount: visitedPageStates.size,
        requiresAuthDetected,
        blockedDetected
      };
    } finally {
      materializedSession.cleanup();
      if (context) {
        try {
          await context.close();
        } catch (error) {
          logger.warn("Failed to close browser context", {
            traceId: input.traceId,
            runId: input.runId,
            source: input.sourceName,
            stage: "browser_discovery_close_context",
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      try {
        await browser.close();
      } catch (error) {
        logger.warn("Failed to close browser instance", {
          traceId: input.traceId,
          runId: input.runId,
          source: input.sourceName,
          stage: "browser_discovery_close_instance",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private async newContext(
    browser: Awaited<ReturnType<typeof chromium.launch>>,
    sessionPath?: string,
    harPath?: string
  ): Promise<BrowserContext> {
    const contextOptions = harPath
      ? {
          recordHar: {
            path: harPath,
            mode: "minimal" as const
          }
        }
      : {};

    if (sessionPath && fs.existsSync(sessionPath)) {
      return browser.newContext({ storageState: sessionPath, ...contextOptions });
    }

    return browser.newContext(contextOptions);
  }

  private async injectCookies(context: BrowserContext, profileId?: string, cookieFile?: string): Promise<void> {
    const raw = this.authManager.loadCookies(profileId, cookieFile);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return;
      }
      await context.addCookies(parsed as Parameters<BrowserContext["addCookies"]>[0]);
    } catch (error) {
      logger.warn("Failed to parse cookie JSON", {
        cookieFile,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private shouldUseStagehand(): boolean {
    return Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
  }

  private async captureWithStagehand(input: BrowserCaptureInput): Promise<BrowserCaptureResult | null> {
    const timeoutMs = input.timeoutMs ?? 45_000;
    const screenshotsDir = path.join(input.evidenceDir, "screenshots");
    const rawDir = path.join(input.evidenceDir, "raw");
    fs.mkdirSync(screenshotsDir, { recursive: true });
    fs.mkdirSync(rawDir, { recursive: true });

    const stamp = Date.now();
    const screenshotPath = path.join(screenshotsDir, `${input.sourceName}-${stamp}-stagehand.png`);
    const rawSnapshotPath = path.join(rawDir, `${input.sourceName}-${stamp}-stagehand.html`);

    try {
      const stagehandLib = (await import("@browserbasehq/stagehand")) as unknown as {
        Stagehand?: new (config: Record<string, unknown>) => {
          init?: () => Promise<void>;
          close?: () => Promise<void>;
          page?: {
            goto: (url: string, options?: Record<string, unknown>) => Promise<void>;
            screenshot: (options: { path: string; fullPage: boolean }) => Promise<void>;
            content: () => Promise<string>;
            url: () => string;
          };
        };
      };

      if (!stagehandLib.Stagehand) {
        return null;
      }

      const stagehand = new stagehandLib.Stagehand({
        env: "BROWSERBASE",
        apiKey: process.env.BROWSERBASE_API_KEY,
        projectId: process.env.BROWSERBASE_PROJECT_ID,
        modelName: process.env.MODEL_CHEAP_DEFAULT ?? "gemini-3.1-flash-lite",
        verbose: false
      });

      if (stagehand.init) {
        await stagehand.init();
      }

      if (!stagehand.page) {
        if (stagehand.close) {
          await stagehand.close();
        }
        return null;
      }

      await stagehand.page.goto(input.url, { waitUntil: "commit", timeout: timeoutMs });
      await stagehand.page.screenshot({ path: screenshotPath, fullPage: true });
      const html = await stagehand.page.content();
      fs.writeFileSync(rawSnapshotPath, html, "utf-8");

      const finalUrl = stagehand.page.url();
      const requiresAuthDetected = containsAuthIndicators(html);
      const blockedDetected = containsBlockedIndicators(html);

      if (stagehand.close) {
        await stagehand.close();
      }

      logger.info("Captured via Stagehand", {
        traceId: input.traceId,
        runId: input.runId,
        source: input.sourceName,
        stage: "browser_stagehand"
      });

      return {
        finalUrl,
        screenshotPath,
        preAuthScreenshotPath: null,
        postAuthScreenshotPath: null,
        rawSnapshotPath,
        tracePath: null,
        harPath: null,
        requiresAuthDetected,
        blockedDetected,
        modelUsed: process.env.MODEL_CHEAP_DEFAULT ?? "gemini-3.1-flash-lite"
      };
    } catch (error) {
      logger.warn("Stagehand path failed, falling back to Playwright", {
        traceId: input.traceId,
        runId: input.runId,
        source: input.sourceName,
        stage: "browser_stagehand_fallback",
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async scrollPage(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      let previousHeight = 0;
      for (let step = 0; step < 6; step += 1) {
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(300);
        const currentHeight = document.body.scrollHeight;
        if (currentHeight === previousHeight) {
          break;
        }
        previousHeight = currentHeight;
      }
      window.scrollTo(0, 0);
    });
  }

  private async captureRenderedPageProgress(page: Page): Promise<RenderedPageProgressSnapshot> {
    return page.evaluate(() => ({
      url: window.location.href,
      anchorCount: document.querySelectorAll("a[href]").length,
      imageCount: document.querySelectorAll("img[src]").length,
      itemCount: document.querySelectorAll("article, li, [data-testid*='item'], [data-testid*='lot']").length,
      textLength: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().length
    }));
  }

  private async followNextPage(
    page: Page,
    beforeProgress: RenderedPageProgressSnapshot,
    timeoutMs: number
  ): Promise<boolean> {
    const nextLocators = [
      page.locator("a[rel='next']").first(),
      page.locator("button[aria-label*='next' i]").first(),
      page.locator("a:has-text('Next')").first(),
      page.locator("button:has-text('Next')").first(),
      page.locator("a:has-text('Sonraki')").first(),
      page.locator("button:has-text('Sonraki')").first(),
      page.locator("a:has-text('Daha fazla')").first(),
      page.locator("button:has-text('Daha fazla')").first()
    ];

    for (const locator of nextLocators) {
      try {
        if ((await locator.count()) === 0 || !(await locator.isVisible())) {
          continue;
        }
        const before = page.url();
        await locator.click({ timeout: 2_000 });
        await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => undefined);
        await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => undefined);
        await wait(500);
        const after = page.url();
        const afterProgress = await this.captureRenderedPageProgress(page);
        if (after !== before || didRenderedPaginationAdvance(beforeProgress, afterProgress)) {
          return true;
        }
      } catch {
        // fall through to alternate candidates
      }
    }

    const nextUrl = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
      const next = candidates.find((link) => {
        const text = (link.textContent ?? "").trim().toLowerCase();
        return text === "next" || text === "sonraki" || text.includes("daha fazla");
      });
      return next?.href ?? null;
    });

    if (!nextUrl || nextUrl === beforeProgress.url) {
      return false;
    }

    await page.goto(nextUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    return true;
  }
}
