// Tests for the parts of the updater that decide what the user is told: the version comparison that
// gates a notice, and the one-line summary that notice carries. Network and filesystem paths are
// deliberately not covered here — they are the extension's runtime surface, exercised by installing
// the plugin, not by a unit test.

import test from "node:test";
import assert from "node:assert/strict";

import { cmpVersion, manifestUrl, summarize } from "../plugins/omp-suite/extensions/omp-updater/index.js";

function row(over) {
  return { id: "x", local: "1.0.0", remote: "1.0.0", error: null, installed: true, update: false, ...over };
}

test("cmpVersion orders plain releases", () => {
  assert.equal(cmpVersion("1.0.0", "1.0.0"), 0);
  assert.equal(cmpVersion("1.0.1", "1.0.0"), 1);
  assert.equal(cmpVersion("1.0.0", "1.0.1"), -1);
  assert.equal(cmpVersion("1.2.0", "1.10.0"), -1);
  assert.equal(cmpVersion("2.0.0", "1.99.99"), 1);
});

test("cmpVersion tolerates a v prefix, a pre-release suffix and ragged lengths", () => {
  assert.equal(cmpVersion("v1.2.3", "1.2.3"), 0);
  assert.equal(cmpVersion("1.2.3-rc.1", "1.2.3"), 0);
  assert.equal(cmpVersion("1.2", "1.2.0"), 0);
  assert.equal(cmpVersion("1.2.1", "1.2"), 1);
});

test("cmpVersion never reports a downgrade as an update", () => {
  // The check only fires when remote is strictly greater; equal versions must not read as updates.
  const local = "2.2.0";
  assert.equal(cmpVersion(local, local) > 0, false);
  assert.equal(cmpVersion("2.1.9", local) > 0, false);
});

test("manifestUrl reads the repository root unless the plugin lives deeper", () => {
  // The suite is a plugin inside its own marketplace repository, so its manifest is not at the
  // root — reading the root there compared the wrong file and hid the suite's own releases.
  assert.equal(
    manifestUrl({ repo: "dillydalli3r/omp-terminal-images" }),
    "https://raw.githubusercontent.com/dillydalli3r/omp-terminal-images/main/package.json",
  );
  assert.equal(
    manifestUrl({ repo: "dillydalli3r/omp-addons", path: "plugins/omp-suite/package.json" }),
    "https://raw.githubusercontent.com/dillydalli3r/omp-addons/main/plugins/omp-suite/package.json",
  );
});

test("summarize names every update with both versions", () => {
  const line = summarize([
    row({ id: "terminal-images", local: "1.0.0", remote: "1.1.0", update: true }),
    row({ id: "deepseek-flash-vision" }),
  ]);
  assert.match(line, /1 update:/);
  assert.match(line, /terminal-images 1\.0\.0 → 1\.1\.0/);
  assert.doesNotMatch(line, /deepseek-flash-vision/);
});

test("summarize reports missing and failed checks separately from updates", () => {
  const line = summarize([
    row({ id: "omp-suite", local: null, remote: "1.0.0", installed: false }),
    row({ id: "terminal-images", error: "HTTP 404" }),
  ]);
  assert.match(line, /not installed: omp-suite/);
  assert.match(line, /check failed: terminal-images/);
  assert.doesNotMatch(line, /update/);
});

test("summarize says so when there is nothing to say", () => {
  assert.equal(summarize([row({}), row({ id: "y" })]), "all up to date");
});
