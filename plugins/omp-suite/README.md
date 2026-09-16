# omp-suite

The updater for the [omp-addons](../..) set. It ships no token economy, no images and no model
patches — it reports when one of the other three is behind, and installs it when you say so.

## Commands

| Command | Effect |
|---|---|
| `/omp-addons` | Status: installed vs published version for each project in the set |
| `/omp-addons check` | Check the published versions now |
| `/omp-addons update` | Refresh the catalog and reinstall anything behind |
| `/omp-addons help` | Usage |

## Nothing runs at session start

The extension registers no `session_start` hook: an update notice is a launch print, and this set
prints nothing on launch. The version check is on demand only — `/omp-addons` or
`/omp-addons check` — so a session that never asks never pays for a fetch.

A check reads, per project:

1. The installed version from `~/.omp/plugins/node_modules/<package>/package.json`, falling back to
   `omp-plugins.lock.json`.
2. The published version from `raw.githubusercontent.com/<repo>/main/package.json` — no API token,
   no rate limit.

## What it does not do

- It does not update the token saver's dependencies (ponytail, `rtk`, the caveman rule). The pack's
  own `/ai-addons` owns those, because only the pack knows how it installs them.
- It does not re-apply the terminal-image bundle patch. That plugin's own extension detects drift at
  session start — an omp upgrade replaces `dist/cli.js`, and only that code knows what to look for.
- It does not upgrade anything without `/omp-addons update` (or `omp config set marketplace.autoUpdate auto`,
  which is omp's own switch and applies to every marketplace you have added).

## Install

Installed with the rest of the set; see the [root README](../../README.md). On its own:

```bash
omp plugin install omp-suite@omp-addons
```

`omp.extensions` declares `./extensions/omp-updater/index.js`, and the extension has no dependencies —
`node:` builtins only, so there is no `node_modules` for the marketplace install to create.
