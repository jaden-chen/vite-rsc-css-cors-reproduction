import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

async function stylesheetLinks(page) {
  return page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        href: element.href,
        crossOrigin: element.crossOrigin,
      })),
    );
}

export async function checkBrowser({ origin, fixed, assetRequests }) {
  const browser = await chromium.launch();
  const results = { fixed };
  try {
    // Control: the identical lazy import works in a fresh browser context.
    const cold = await browser.newContext({ serviceWorkers: "block" });
    const coldPage = await cold.newPage();
    await coldPage.goto(`${origin}/second`);
    await coldPage.getByRole("button", { name: "Show card" }).click();
    await expect(coldPage.locator(".card")).toHaveCSS(
      "color",
      "rgb(10, 70, 90)",
    );
    results.coldVisit = "passes";
    await cold.close();

    // A separate context keeps the control from priming this HTTP cache.
    const warm = await browser.newContext({ serviceWorkers: "block" });
    const page = await warm.newPage();
    const failures = [];
    const messages = [];
    page.on("requestfailed", (request) =>
      failures.push({
        url: request.url(),
        error: request.failure()?.errorText,
      }),
    );
    page.on("console", (message) => {
      if (message.type() === "error") messages.push(message.text());
    });
    const requestStart = assetRequests.length;
    await page.goto(origin);
    await expect(page.locator(".card")).toHaveCSS("color", "rgb(10, 70, 90)");
    const initialLinks = await stylesheetLinks(page);
    assert.equal(initialLinks.length, 1);
    assert.equal(initialLinks[0].crossOrigin === null, !fixed);
    const stylesheetUrl = initialLinks[0].href;
    const stylesheetPath = new URL(stylesheetUrl).pathname;
    const initialRequests = assetRequests
      .slice(requestStart)
      .filter((request) => request.pathname === stylesheetPath);
    assert.equal(initialRequests.length, 1);
    assert.equal(initialRequests[0].mode, fixed ? "cors" : "no-cors");
    assert.equal(initialRequests[0].origin, fixed ? origin : null);

    // A plain anchor creates a NEW document while retaining the browser HTTP cache.
    // Vite's existing-link deduplication cannot find the old document's link.
    await page.getByRole("link", { name: "Second page" }).click();
    await expect(
      page.getByRole("heading", { name: "Second page", exact: true }),
    ).toBeVisible();
    assert.deepEqual(await stylesheetLinks(page), []);
    const failedStylesheet = fixed
      ? null
      : page.waitForEvent("requestfailed", {
          predicate: (request) => request.url() === stylesheetUrl,
          timeout: 10000,
        });
    await page.getByRole("button", { name: "Show card" }).click();
    if (fixed) {
      await expect(page.locator(".card")).toHaveCSS("color", "rgb(10, 70, 90)");
      assert.deepEqual(failures, []);
      assert.deepEqual(messages, []);
      results.warmVisit = "passes";
    } else {
      await failedStylesheet;
      await expect(
        page.getByText("This page couldn’t load", { exact: true }),
      ).toBeVisible();
      assert.ok(
        messages.some((message) =>
          message.includes("Access-Control-Allow-Origin"),
        ),
      );
      assert.ok(
        messages.some((message) => message.includes("Unable to preload CSS")),
      );
      assert.equal(await page.locator(".card").count(), 0);
      results.warmVisit = "expected CSS CORS failure";
    }
    const finalLinks = await stylesheetLinks(page);
    assert.equal(finalLinks.length, 1);
    assert.equal(finalLinks[0].href, stylesheetUrl);
    assert.ok(["", "anonymous"].includes(finalLinks[0].crossOrigin));
    const networkRequests = assetRequests
      .slice(requestStart)
      .filter((request) => request.pathname === stylesheetPath);
    assert.equal(
      networkRequests.length,
      1,
      "Second CSS load reuses HTTP cache rather than contacting the asset server",
    );
    results.initialLinks = initialLinks;
    results.lazyImportLinks = finalLinks;
    results.cssNetworkRequests = networkRequests;
    results.failures = failures;
    console.log(JSON.stringify(results, null, 2));
    await warm.close();
  } finally {
    await browser.close();
  }
}
