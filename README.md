# omp-addons

One catalog and one command for the oh-my-pi add-ons that make `omp` cheaper to run and easier to
look at: a token-economy pack, inline images in the TUI, and vision support for DeepSeek Flash.

This repository is an omp **marketplace** — it ships no features of its own except the updater that
keeps the set current. The three projects stay in their own repositories and stay independently
installable; this is the path that installs all of them, and the only path that keeps them updated
from inside a session.

| Plugin | Repository | What it does |
|---|---|---|
| `omp-suite` | this repo | Startup update check and the `/omp-addons` command |
| `supreme-token-saver` | [omp-supreme-token-saver](https://github.com/dillydalli3r/omp-supreme-token-saver) | Nine token-saving knobs behind six presets, one status row, OMP's own read/compress/prune/threshold dials |
| `terminal-images` | [omp-terminal-images](https://github.com/dillydalli3r/omp-terminal-images) | Inline images in the TUI on Windows Terminal, including pasted images in the composer and transcript |
| `deepseek-flash-vision` | [omp-deepseek-flash-vision](https://github.com/dillydalli3r/omp-deepseek-flash-vision) | Declares `deepseek-flash` as image-capable and stops the transport from stripping image parts |

## Install

Without cloning — one command, from any directory:

```bash
npx --yes --allow-git=all github:dillydalli3r/omp-addons install --yes
```

From a clone:

```bash
git clone https://github.com/dillydalli3r/omp-addons
cd omp-addons
node install.mjs --yes
```

Then **start a new omp session**. The installer registers the marketplace, installs the four plugins,
and runs each project's own setup step:

| Step | What it runs |
|---|---|
| Marketplace | `omp plugin marketplace add dillydalli3r/omp-addons` (or update, if already added) |
| Plugins | `omp plugin install --force <plugin>@omp-addons` for each of the four |
| token saver | its own installer: remove any legacy install, then `plugin` — installs ponytail and the `rtk` binary |
| terminal images | its own `install.ps1`: Windows Terminal profile env, user env, `terminal.showImages`, and the bundle patch |
| DeepSeek vision | `npm install --omit=dev` in the plugin directory, then `apply.mjs` — writes `~/.omp/agent/models.yml` |

Flags: `--dry-run` (print every action, run none), `--only <id,...>` (a subset), `--no-setup`
(register and install only), `--local <path>` (register a local checkout instead of GitHub).

Each project's own setup step is its own script with its own flags — `install-omp-addons.js` gains a
`plugin` verb and a `--legacy-only` cutover for the token saver, `install.ps1` takes `-DryRun`,
`-Json`, `-SkipUserEnv` and `-Uninstall` for terminal images, and `apply.mjs` takes `--check` and
`--dry-run` for the DeepSeek override. Each repository's README documents them.

Doing it by hand is two commands per plugin:

```bash
omp plugin marketplace add dillydalli3r/omp-addons
omp plugin install supreme-token-saver@omp-addons
omp plugin install terminal-images@omp-addons
omp plugin install deepseek-flash-vision@omp-addons
omp plugin install omp-suite@omp-addons
```

The first three then need their setup step (the table above) — `install.mjs` is the only thing that
knows to run them, which is why it exists.

## Updates

`omp-suite` checks at session start, at most once every six hours, and notifies only when something
is actually behind. Nothing blocks the first prompt: the check runs off the turn and an unreachable
GitHub costs nothing but a retry next time.

```
/omp-addons            status — installed vs published version, per project
/omp-addons check      force a network check now
/omp-addons update     refresh the catalog and reinstall anything behind
/omp-addons level on|off   check at session start (on by default)
```

omp has its own knob for the same idea, which this set leaves alone:

```bash
omp config set marketplace.autoUpdate auto     # off | notify (default) | auto
```

`notify` writes update availability to the debug log only, which is why the suite reports in-session
instead. `auto` upgrades plugins from the catalog without asking; the suite still reports, so you can
tell what changed.

The token saver has dependencies of its own — ponytail, the `rtk` binary, and the caveman rule text.
Those are checked by the pack's own `/ai-addons check` and `/ai-addons update`, and by the same
startup check.

Two things are deliberately not auto-updated, because they rewrite software you did not ask them to
rewrite:

- **The terminal-image bundle patch.** `install.ps1` edits `@oh-my-pi/pi-coding-agent/dist/cli.js`.
  Any omp upgrade replaces that file and silently reverts the fix, so the patch is re-detected at
  session start and re-applied — by the plugin's own extension, which reports what it did.
- **`models.yml`.** The DeepSeek override is checked at session start and rewritten only when it has
  been lost; the file is yours otherwise, and every edit is backed up.

## Requirements

- `omp` on `PATH` (tested against 18.2.x)
- Node 18+ for the installer, `bun` for omp itself
- The terminal-image half is Windows Terminal only, and needs WT 1.22+ for SIXEL
- Network access for the marketplace, npm installs, and the startup check

## On disk

```
~/.omp/plugins/marketplaces.json                     this catalog, registered
~/.omp/plugins/installed_plugins.json                which plugins, at which version and scope
~/.omp/plugins/omp-plugins.lock.json                 runtime enable/feature state
~/.omp/plugins/node_modules/<package>                symlink into the plugin cache
~/.omp/plugins/cache/plugins/omp-addons___<plugin>___<version>/
~/.omp/agent/omp-addons.json                         suite config (startup check on/off)
~/.omp/agent/omp-addons-state.json                   last check, last notice
```

Nothing here edits `~/.omp/agent/config.yml` `extensions:`; the marketplace registration is the
registration.

## Uninstall

```bash
omp plugin uninstall --scope user supreme-token-saver@omp-addons
omp plugin uninstall --scope user terminal-images@omp-addons
omp plugin uninstall --scope user deepseek-flash-vision@omp-addons
omp plugin uninstall --scope user omp-suite@omp-addons
omp plugin marketplace remove omp-addons
```

Each project's own README covers reverting what its setup step changed — `install.ps1 -Uninstall` for
the terminal-image env and bundle patch, the `models.yml` note for the DeepSeek override, and
`install-omp-addons.js uninstall` for the token saver's dependency layout.

## Development

```bash
npm run check      # syntax-check the installer and the suite extension
npm test           # node --test
npm run dry-run    # the installer must stay offline-safe and write nothing
```

`install.mjs` is held to the same rule the token saver's installer is: a dry run performs no network
call and no write, so it can be run anywhere, any time.

## License

MIT
