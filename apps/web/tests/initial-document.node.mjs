import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

test("the initial document does not paint guide copy before React mounts", () => {
  assert.match(html, /<div id="root"><\/div>/);
  assert.doesNotMatch(html, /<div id="root">\s*<main/);
});

test("the guide remains available when JavaScript is disabled", () => {
  const noScriptContent = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1];
  assert.ok(noScriptContent?.includes("One list for everything you might buy."));
  assert.ok(noScriptContent?.includes("Add Tracer to Chrome"));
  assert.ok(noScriptContent?.includes('href="/privacy"'));
});
