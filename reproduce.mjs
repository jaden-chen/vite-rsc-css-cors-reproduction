import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { checkBrowser } from "./browser-checks.mjs";
import { applyProposedPatch } from "./patch-rsc.mjs";

const fixed = process.argv.includes("--fixed");
const serve = process.argv.includes("--serve");
const origin = "http://127.0.0.1:4173";
const assetOrigin = "http://127.0.0.1:4174";
const assetRequests = [];

const assets = createServer(async (request, response) => {
  const pathname = new URL(request.url, assetOrigin).pathname;
  try {
    if (!pathname.startsWith("/_next/static/")) throw new Error("Not an asset");
    const body = await readFile(
      new URL(`./dist/client${pathname}`, import.meta.url),
    );
    if (pathname.endsWith(".css")) {
      assetRequests.push({
        pathname,
        origin: request.headers.origin ?? null,
        mode: request.headers["sec-fetch-mode"],
      });
    }
    response.setHeader(
      "Content-Type",
      pathname.endsWith(".css") ? "text/css" : "text/javascript",
    );
    response.setHeader("Cache-Control", "public,max-age=3600,immutable");
    // Model the reported asset-origin behavior: neither ACAO nor Vary on no-Origin requests.
    // This is a local fixture, not a claim that every CDN has this policy.
    if (request.headers.origin) {
      response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
      response.setHeader("Vary", "Origin");
    }
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

function start(arguments_) {
  return spawn(
    process.execPath,
    ["node_modules/vinext/dist/cli.js", ...arguments_],
    {
      env: { ...process.env, TEST_ASSET_ORIGIN: assetOrigin },
      stdio: "inherit",
    },
  );
}

async function build() {
  const restore = fixed ? await applyProposedPatch() : null;
  try {
    await new Promise((resolve, reject) => {
      const child = start(["build"]);
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`Build failed: ${code}`)),
      );
    });
  } finally {
    await restore?.();
  }
}

let application;
try {
  await new Promise((resolve, reject) => {
    assets.once("error", reject);
    assets.listen(4174, "127.0.0.1", resolve);
  });
  await build();
  application = start(["start", "--port", "4173"]);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(application.exitCode, null, "Application must remain running");
    try {
      if ((await fetch(origin)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the local application server to listen. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "Application must start");
  if (serve) {
    console.log(
      `Open ${origin} in a fresh browser context. Follow Second page, then Show card.`,
    );
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } else {
    await checkBrowser({ origin, fixed, assetRequests });
  }
} finally {
  if (application && application.exitCode === null) {
    const stopped = new Promise((resolve) => application.once("exit", resolve));
    application.kill();
    await stopped;
  }
  await new Promise((resolve) => assets.close(resolve));
}
