import fs from "node:fs";
import path from "node:path";
import { AuthManager } from "@artbot/auth-manager";
import { logger } from "@artbot/observability";
import type { AccessContext } from "@artbot/shared-types";
import { chromium, type BrowserContext } from "playwright";

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function containsAuthIndicators(content: string): boolean {
  const indicators = ["sign in", "log in", "oturum aç", "giriş yap", "member login", "subscribe to view"]; 
  const lower = content.toLowerCase();
  return indicators.some((token) => lower.includes(token));
}

function containsBlockedIndicators(content: string): boolean {
  const indicators = ["access denied", "forbidden", "blocked", "captcha", "cloudflare"];
  const lower = content.toLowerCase();
  if (indicators.some((token) => lower.includes(token))) {
    return true;
  }

  return /\b(?:too many requests|status\s*code\s*:?\s*429|error\s*429|http\s*429)\b/i.test(lower);
}

export class BrowserClient {
  constructor(private readonly authManager: AuthManager) {}

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

    if (sessionPath && refreshDecision.refresh && fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { force: true });
    }

    const browser = await chromium.launch({ headless: true });
    let context: BrowserContext | null = null;
    let traceStarted = false;

    try {
      context = await this.newContext(
        browser,
        sessionPath,
        input.captureHeavyEvidence ? harPath : undefined
      );
      await this.injectCookies(context, input.accessContext.cookieFile);

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

      await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

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

      if (sessionPath) {
        await context.storageState({ path: sessionPath });
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

  private async injectCookies(context: BrowserContext, cookieFile?: string): Promise<void> {
    const raw = this.authManager.loadCookies(cookieFile);
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

      await stagehand.page.goto(input.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
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
}
