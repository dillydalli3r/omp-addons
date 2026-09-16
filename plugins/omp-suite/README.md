# omp-suite

The updater for the [omp-addons](../..) set. It ships no token economy, no images and no model
patches — it tells you when one of the other three is behind, and installs it when you say so.

## Commands

| Command | Effect |
|---|---|
| `/omp-addons` | Status: installed vs published version for each project in the set |
| `/omp-addons check` | Force a network check now |
| `/omp-addons update` | Refresh the catalog and reinstall anything behind |
| `/omp-addons level on\|off` | Check at session start (on by default) |
| `/omp-addons help` | Usage |

## Startup check

At session start, off the turn, at most once per `intervalHours` (default 6):

1. Read each plugin's installed version from `~/.omp/plugins/node_modules/<package>/package.json`,
   falling back to `omp-plugins.lock.json`.
2. Read each repository's published version from `raw.githubusercontent.com/<repo>/main/package.json`
   — no API token, no rate limit.
3. Notify once, with one line, only when something is genuinely behind. The same set of updates is
   never announced twice; a new release produces a new notice.

State lives in `~/.omp/agent/omp-addons-state.json` (`lastCheck`, `notified`). Config lives in
`~/.omp/agent/omp-addons.json`:

```json
{ "checkOnStart": true, "intervalHours": 6 }
```

The timestamp is written *before* the fetch, so a machine that is offline at every start does not
re-attempt the whole set on every session.

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
