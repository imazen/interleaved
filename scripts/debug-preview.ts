#!/usr/bin/env npx tsx
/**
 * Debug the preview worker + admin integration.
 */

import { chromium } from "playwright";

const WORKER = "https://preview.interleaved.app";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      console.log(`  [console.${msg.type()}]`, msg.text().slice(0, 200));
    }
  });
  page.on("pageerror", (err) => {
    console.log(`  [pageerror]`, err.message);
  });
  page.on("requestfailed", (req) => {
    if (req.url().includes("cloudflareinsights")) return;
    console.log(`  [failed] ${req.method()} ${req.url().slice(0, 80)}: ${req.failure()?.errorText}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400 && !res.url().includes("cloudflareinsights")) {
      console.log(`  [${res.status()}] ${res.url().slice(0, 100)}`);
    }
  });

  // --- Test 1: worker headers ---
  console.log("\n=== Test 1: worker headers ===");
  {
    const url = `${WORKER}/lilith/genandlilith/main/`;
    const response = await page.request.get(url);
    console.log(`  Status: ${response.status()}`);
    const headers = response.headers();
    const csp = headers["content-security-policy"] || "";
    const xfo = headers["x-frame-options"] || "NONE";
    console.log(`  X-Frame-Options: ${xfo}`);
    const frameAncestors = csp.match(/frame-ancestors[^;]+/)?.[0] || "NOT SET";
    console.log(`  ${frameAncestors}`);

    if (xfo !== "NONE") {
      console.log(`  ❌ X-Frame-Options is set — conflicts with frame-ancestors!`);
    } else {
      console.log(`  ✓ X-Frame-Options not set`);
    }
  }

  // --- Test 2: iframe from interleaved.app origin ---
  console.log("\n=== Test 2: iframe embedding from interleaved.app ===");
  {
    await page.route("https://interleaved.app/iframe-test", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!DOCTYPE html><html><body><iframe id="preview" src="${WORKER}/lilith/genandlilith/main/" sandbox="allow-same-origin" referrerpolicy="no-referrer" style="width:800px;height:600px;"></iframe></body></html>`,
      });
    });

    const response = await page.goto("https://interleaved.app/iframe-test");
    console.log(`  Parent status: ${response?.status()}`);

    await page.waitForTimeout(5000);

    const frames = page.frames();
    console.log(`  Total frames: ${frames.length}`);
    for (const f of frames) {
      const url = f.url().slice(0, 80);
      if (url) console.log(`    - ${url}`);
    }

    const previewFrame = page.frame({ url: /preview\.interleaved\.app/ });
    if (previewFrame) {
      console.log(`  ✓ Preview iframe loaded`);
      try {
        const title = await previewFrame.title();
        const bodyText = await previewFrame.evaluate(() => document.body.innerText);
        console.log(`  Title: ${title || "(empty)"}`);
        console.log(`  Body (first 200 chars): ${bodyText.slice(0, 200).replace(/\s+/g, " ")}`);
      } catch (e: any) {
        console.log(`  Could not read iframe content: ${e.message}`);
      }
    } else {
      console.log(`  ❌ Preview iframe NOT loaded — framing blocked`);
    }
  }

  await browser.close();
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
