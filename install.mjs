#!/usr/bin/env node
// omp-addons installer.
//
// Three steps, in order: register this catalog with omp, install the plugins from it, then run each
// plugin's own one-time setup. The setup step is where the work that a plugin cannot do from inside
// a session lives — installing the rtk binary, writing models.yml, patching omp's bundle.
//
// Everything after step 1 is idempotent: re-running installs the current catalog version and re-runs
// each project's own setup, which is the repair path after an omp upgrade clobbers something.
//
// Built-in Node modules only.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const IS_WINDOWS = process.platform === "win32";
const HOME = os.homedir();
const DEFAULT_SOURCE = "dillydalli3r/omp-addons";
const MARKETPLACE = "omp-addons";

// `setup` runs against the installed plugin directory (the symlink target in the plugins tree).
// A null setup means the plugin install is the whole job.
const PLUGINS = [
  { id: "omp-suite", pkg: "@dillydalli3r/omp-suite", setup: null },
  {
    id: "supreme-token-saver",
    pkg: "@dillydalli3r/omp-supreme-token-saver",
    setup: setupTokenSaver,
  },
  {
    id: "terminal-images",
    pkg: "@dillydalli3r/omp-terminal-images",
    setup: setupTerminalImages,
  },
  {
    id: "deepseek-flash-vision",
    pkg: "@dillydalli3r/omp-deepseek-flash-vision",
    setup: setupDeepseekVision,
  },
];

// ---------------------------------------------------------------------------
// arguments

const argv = process.argv.slice(2);
const flags = new Set();
const options = new Map();
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith("-")) continue;
  const [name, inline] = arg.split("=");
  if (inline !== undefined) options.set(name, inline);
  else if (argv[i + 1] && !argv[i + 1].startsWith("-") && ["--source", "--only", "--local"].includes(name)) options.set(name, argv[++i]);
  else flags.add(name);
}

const dryRun = flags.has("--dry-run");
const assumeYes = flags.has("--yes") || flags.has("-y");
const skipSetup = flags.has("--no-setup");
const source = options.get("--source") || (options.get("--local") ? options.get("--local") : DEFAULT_SOURCE);
const only = options.get("--only") ? new Set(options.get("--only").split(",").map((id) => id.trim())) : null;

if (flags.has("--help") || flags.has("-h")) {
  process.stdout.write(`omp-addons installer

  node install.mjs [--dry-run] [--yes] [--only <id,...>] [--no-setup] [--source <owner/repo> | --local <path>]

  --dry-run    print every action, run none of them
  --yes        do not prompt (the installer never prompts today; accepted for scripting symmetry)
  --only       install a subset, by plugin id (${PLUGINS.map((p) => p.id).join(", ")})
  --no-setup   register and install the plugins, skip each project's own setup step
  --source     marketplace source, default ${DEFAULT_SOURCE}
  --local      register a local checkout of this repository instead
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// process helpers

function pluginsRoot() {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) {
    const candidate = path.join(xdg, "omp", "plugins");
    if (existsSync(candidate)) return candidate;
  }
  return path.join(HOME, ".omp", "plugins");
}

function pluginDir(pkg) {
  return path.join(pluginsRoot(), "node_modules", ...pkg.split("/"));
}

// Windows resolves omp/npx/npm to .cmd shims that a shell-less spawn cannot execute, so those go
// through the command interpreter there.
function cliCommand(name, args) {
  const quoted = args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg));
  return IS_WINDOWS ? [process.env.ComSpec || "cmd.exe", ["/c", name, ...quoted]] : [name, quoted];
}

function run(label, name, args, { cwd } = {}) {
  const [command, commandArgs] = cliCommand(name, args);
  const rendered = `${name} ${args.join(" ")}`;
  if (dryRun) {
    process.stdout.write(`  [dry-run] ${label}: ${rendered}${cwd ? ` (in ${cwd})` : ""}\n`);
    return true;
  }
  process.stdout.write(`  ${label}: ${rendered}\n`);
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: "inherit",
    env: process.env,
    timeout: 600_000,
  });
  if (result.error) {
    process.stdout.write(`  [!!] ${label} could not start: ${result.error.message}\n`);
    return false;
  }
  if (result.status !== 0) {
    process.stdout.write(`  [!!] ${label} exited ${result.status}\n`);
    return false;
  }
  return true;
}

function nodeFile(dir, file, args) {
  return ["node", [path.join(dir, file), ...args]];
}

// ---------------------------------------------------------------------------
// per-project setup

function setupTokenSaver(dir) {
  const installer = path.join(dir, "install-omp-addons.js");
  // The guard is a post-install check: in a dry run nothing is installed yet, so it only describes.
  if (!dryRun && !existsSync(installer)) {
    process.stdout.write(`  [!!] supreme-token-saver: ${installer} is missing from the installed plugin\n`);
    return false;
  }
  // The pack ships its own installer and registers extensions by editing config.yml. The marketplace
  // registration supersedes that, and both at once double-registers every command, so the legacy
  // tree is removed first. `uninstall` leaves ~/.omp/plugins and the rtk binary alone.
  let ok = run("supreme-token-saver: remove any legacy install", ...nodeFile(dir, "install-omp-addons.js", ["uninstall", "--yes"]));
  // `plugin` installs the runtime dependencies only — ponytail and the rtk binary — and touches
  // neither the extension tree nor config.yml.
  ok = run("supreme-token-saver: install dependencies (ponytail, rtk)", ...nodeFile(dir, "install-omp-addons.js", ["plugin", "--yes"])) && ok;
  return ok;
}

function setupTerminalImages(dir) {
  if (!IS_WINDOWS) {
    process.stdout.write("  [--] terminal-images: Windows-only fix, skipped on this platform\n");
    return true;
  }
  const script = path.join(dir, "install.ps1");
  if (!dryRun && !existsSync(script)) {
    process.stdout.write(`  [!!] terminal-images: ${script} is missing from the installed plugin\n`);
    return false;
  }
  // `install.ps1` is the only writer of the Windows Terminal profile env and the bundle patch, and
  // it re-applies the patch after an omp upgrade replaces the bundle.
  const shell = existsSync("C:/Program Files/PowerShell/7/pwsh.exe") ? "pwsh" : "powershell";
  return run("terminal-images: env, config and bundle patch", ...cliCommand(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script]));
}

function setupDeepseekVision(dir) {
  const apply = path.join(dir, "apply.mjs");
  if (!dryRun && !existsSync(apply)) {
    process.stdout.write(`  [!!] deepseek-flash-vision: ${apply} is missing from the installed plugin\n`);
    return false;
  }
  // apply.mjs parses and rewrites YAML, so the plugin's one dependency has to be present — the
  // marketplace install clones the repository but does not run a package manager.
  let ok = run("deepseek-flash-vision: install dependencies", "npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: dir });
  ok = run("deepseek-flash-vision: write the models.yml override", ...nodeFile(dir, "apply.mjs", [])) && ok;
  return ok;
}

// ---------------------------------------------------------------------------
// steps

const results = [];

function step(label, fn) {
  process.stdout.write(`\n${label}\n`);
  const ok = fn();
  results.push([label, ok]);
  return ok;
}

process.stdout.write(`omp-addons installer${dryRun ? " (dry run)" : ""}\n`);
process.stdout.write(`  marketplace source: ${source}\n`);
process.stdout.write(`  plugins root:       ${pluginsRoot()}\n`);

step("Register the marketplace", () =>
  // Adding an already-registered marketplace fails; updating it is the same intent.
  run("marketplace add", "omp", ["plugin", "marketplace", "add", source]) ||
  run("marketplace update", "omp", ["plugin", "marketplace", "update", MARKETPLACE]),
);

const selected = PLUGINS.filter((plugin) => !only || only.has(plugin.id));
step("Install the plugins", () => {
  let ok = true;
  for (const plugin of selected) {
    ok = run(`install ${plugin.id}`, "omp", ["plugin", "install", "--force", `${plugin.id}@${MARKETPLACE}`]) && ok;
  }
  return ok;
});

if (!skipSetup) {
  step("Run each project's setup", () => {
    let ok = true;
    for (const plugin of selected) {
      if (!plugin.setup) continue;
      ok = plugin.setup(pluginDir(plugin.pkg)) && ok;
    }
    return ok;
  });
}

process.stdout.write("\nSummary\n");
for (const [label, ok] of results) process.stdout.write(`  [${ok ? "ok" : "!!"}] ${label}\n`);

const failed = results.filter(([, ok]) => !ok).length;
if (failed) {
  process.stdout.write(`\n${failed} step(s) failed. Re-run \`node install.mjs\` after fixing the cause above.\n`);
} else if (!dryRun) {
  process.stdout.write("\nDone. Start a new omp session; the suite checks for newer versions from then on.\n");
}
process.exit(failed ? 1 : 0);
