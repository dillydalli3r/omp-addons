// OMP extension: /omp-addons — startup update check, status and upgrade for the omp-addons set.
//
// Built-in Node modules only: the suite is installed from this marketplace and has no dependency
// tree of its own, so there is nothing here for a package manager to keep current.
//
// What this owns: the four repos in the set (see PROJECTS). What it does not own: the token saver's
// own dependencies (ponytail, rtk, caveman) — the pack's /ai-addons updater checks those, and the
// terminal-image patch's drift, which the terminal-images plugin repairs itself.

import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const IS_WINDOWS = process.platform === "win32";
const HOME = os.homedir();
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || path.join(HOME, ".omp", "agent");
const STATE_PATH = path.join(AGENT_DIR, "omp-addons-state.json");
const CONFIG_PATH = path.join(AGENT_DIR, "omp-addons.json");
const MARKETPLACE = "omp-addons";
const BRANCH = "main";
const RELOAD_MSG = "Restart omp for an upgraded plugin to take effect.";
const FETCH_TIMEOUT_MS = 6000;

// `plugin` is the name in this marketplace's catalog; `pkg` is the package.json name the install is
// keyed by in node_modules and omp-plugins.lock.json.
const PROJECTS = [
  {
    id: "supreme-token-saver",
    plugin: "supreme-token-saver",
    pkg: "@dillydalli3r/omp-supreme-token-saver",
    repo: "dillydalli3r/omp-supreme-token-saver",
  },
  {
    id: "terminal-images",
    plugin: "terminal-images",
    pkg: "@dillydalli3r/omp-terminal-images",
    repo: "dillydalli3r/omp-terminal-images",
  },
  {
    id: "deepseek-flash-vision",
    plugin: "deepseek-flash-vision",
    pkg: "@dillydalli3r/omp-deepseek-flash-vision",
    repo: "dillydalli3r/omp-deepseek-flash-vision",
  },
  {
    id: "omp-suite",
    plugin: "omp-suite",
    pkg: "@dillydalli3r/omp-suite",
    repo: "dillydalli3r/omp-addons",
  },
];

const DEFAULT_CONFIG = { checkOnStart: true, intervalHours: 6 };

// ---------------------------------------------------------------------------
// paths and small helpers

// Marketplace state moves under $XDG_DATA_HOME/omp once that root exists (Linux/macOS); the
// non-XDG default is ~/.omp. Whichever root is present on disk is the one omp actually uses.
function pluginsRoot() {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) {
    const candidate = path.join(xdg, "omp", "plugins");
    if (existsSync(candidate)) return candidate;
  }
  return path.join(HOME, ".omp", "plugins");
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadConfig() {
  const raw = (await readJson(CONFIG_PATH)) || {};
  return {
    checkOnStart: raw.checkOnStart !== false,
    intervalHours: Number.isFinite(raw.intervalHours) && raw.intervalHours > 0 ? raw.intervalHours : DEFAULT_CONFIG.intervalHours,
  };
}

function cliCommand(name, args) {
  const argv = args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg));
  return IS_WINDOWS ? [process.env.ComSpec || "cmd.exe", ["/c", name, ...argv]] : [name, argv];
}

function notify(ctx, message, level = "info") {
  // Never throw out of a notification: a print run or RPC session has no ui, and a dead notify must
  // not abort the check that produced it.
  try {
    ctx?.ui?.notify?.(String(message), level);
  } catch {}
}

// ---------------------------------------------------------------------------
// versions

// Installed version, read from the package the plugin is symlinked to. Falls back to the lock file,
// which records what omp believes is installed when node_modules is missing.
async function localVersion(pkg) {
  const manifest = await readJson(path.join(pluginsRoot(), "node_modules", ...pkg.split("/"), "package.json"));
  if (manifest?.version) return String(manifest.version);
  const lock = await readJson(path.join(pluginsRoot(), "omp-plugins.lock.json"));
  const entry = lock?.plugins?.[pkg];
  return entry?.version ? String(entry.version) : null;
}

// The repo's own package.json on the default branch — the same file the marketplace clone carries,
// so it is the version the next install would land on. Clones are raw-fetched, not API-fetched:
// no rate limit, no auth, and no token needed on a machine that has never run `gh auth login`.
async function remoteVersion(repo) {
  const url = `https://raw.githubusercontent.com/${repo}/${BRANCH}/package.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "omp-addons", accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    return manifest?.version ? String(manifest.version) : null;
  } finally {
    clearTimeout(timer);
  }
}

// Semver-ish comparison over the dotted numeric parts, ignoring a leading `v` and any pre-release
// suffix. The set only ever publishes plain x.y.z, where this agrees with semver exactly.
// Exported for the tests; the extension loader only ever takes the default export.
export function cmpVersion(a, b) {
  const parse = (value) =>
    String(value)
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// the check

async function checkProjects() {
  return Promise.all(
    PROJECTS.map(async (project) => {
      const local = await localVersion(project.pkg);
      let remote = null;
      let error = null;
      try {
        remote = await remoteVersion(project.repo);
      } catch (cause) {
        error = cause?.message || String(cause);
      }
      return {
        ...project,
        local,
        remote,
        error,
        installed: local !== null,
        update: Boolean(local && remote && cmpVersion(remote, local) > 0),
      };
    }),
  );
}

function updateLine(row) {
  return `${row.id} ${row.local} → ${row.remote}`;
}

export function summarize(rows) {
  const updates = rows.filter((row) => row.update);
  const missing = rows.filter((row) => !row.installed);
  const failed = rows.filter((row) => row.error);
  const parts = [];
  if (updates.length) parts.push(`${updates.length} update${updates.length === 1 ? "" : "s"}: ${updates.map(updateLine).join(", ")}`);
  if (missing.length) parts.push(`not installed: ${missing.map((row) => row.id).join(", ")}`);
  if (failed.length) parts.push(`check failed: ${failed.map((row) => row.id).join(", ")}`);
  return parts.length ? parts.join(" | ") : "all up to date";
}

function renderStatus(rows) {
  const lines = rows.map((row) => {
    const state = !row.installed
      ? "not installed"
      : row.error
        ? `check failed (${row.error})`
        : row.update
          ? `update available → ${row.remote}`
          : row.remote
            ? "up to date"
            : "version unknown";
    return `  ${row.id.padEnd(22)} ${String(row.local || "—").padEnd(8)} ${state}`;
  });
  return ["omp-addons", `  marketplace: ${MARKETPLACE}`, ...lines].join("\n");
}

async function runCheck(ctx, { announce = true } = {}) {
  const rows = await checkProjects();
  notify(ctx, `omp-addons: ${summarize(rows)}`, rows.some((row) => row.update || row.error) ? "warning" : "info");
  return rows;
}

// Startup runs off the turn, so a slow or unreachable GitHub never delays the first prompt. The
// timestamp is written before the fetch, so a machine that is offline at every start does not
// re-attempt the whole set on every session.
async function runStartupCheck(pi, ctx) {
  const config = await loadConfig();
  if (!config.checkOnStart) return;
  const state = (await readJson(STATE_PATH)) || {};
  const since = Date.now() - (Number(state.lastCheck) || 0);
  if (since < config.intervalHours * 3600_000) return;
  await writeJson(STATE_PATH, { ...state, lastCheck: Date.now() });

  let rows;
  try {
    rows = await checkProjects();
  } catch (cause) {
    return;
  }
  const updates = rows.filter((row) => row.update);
  const signature = updates.map(updateLine).join("|");
  if (!updates.length) {
    await writeJson(STATE_PATH, { lastCheck: Date.now(), notified: "" });
    return;
  }
  // One notice per distinct set of updates: a session that is restarted repeatedly must not repeat
  // the same nags without a new release behind them.
  if (state.notified === signature) return;
  notify(ctx, `omp-addons: ${summarize(rows)} — run /omp-addons update`, "warning");
  await writeJson(STATE_PATH, { ...state, lastCheck: Date.now(), notified: signature });
}

async function upgrade(pi, ctx, rows) {
  const targets = rows.filter((row) => row.update || !row.installed);
  if (!targets.length) {
    notify(ctx, "omp-addons: nothing to upgrade.", "info");
    return;
  }
  notify(ctx, `omp-addons: refreshing the marketplace catalog…`, "info");
  try {
    const [command, argv] = cliCommand("omp", ["plugin", "marketplace", "update", MARKETPLACE]);
    await pi.exec(command, argv, { timeout: 120_000 });
  } catch {
    // A stale catalog is not fatal: upgrade reads the cached catalog, and the next start refreshes it.
  }

  const outcomes = [];
  for (const row of targets) {
    const spec = `${row.plugin}@${MARKETPLACE}`;
    notify(ctx, `omp-addons: installing ${spec}…`, "info");
    try {
      const [command, argv] = cliCommand("omp", ["plugin", "install", "--force", spec]);
      const result = await pi.exec(command, argv, { timeout: 300_000 });
      if (result.code !== 0) throw new Error(result.stderr || `omp exited ${result.code}`);
      outcomes.push(`  ${row.id}: ok`);
    } catch (cause) {
      outcomes.push(`  ${row.id}: failed — ${cause?.message || cause}`);
    }
  }
  const failed = outcomes.some((line) => line.includes("failed"));
  notify(ctx, failed ? "omp-addons: upgrade finished with errors." : `omp-addons: upgraded. ${RELOAD_MSG}`, failed ? "warning" : "info");
  await writeJson(STATE_PATH, { lastCheck: Date.now(), notified: "" });
}

const USAGE = [
  "/omp-addons            status — installed vs published version, per project",
  "/omp-addons check      force a network check now",
  "/omp-addons update     refresh the catalog and reinstall anything behind",
  "/omp-addons level      show the stored level",
  "/omp-addons level on|off   check at session start (stored for new sessions)",
  "/omp-addons help",
].join("\n");

export default function ompAddonsSuite(pi) {
  pi.setLabel?.("OMP add-ons");

  const handler = async (args, ctx) => {
    const parts = String(args || "").trim().split(/\s+/).filter(Boolean);
    const verb = (parts[0] || "status").toLowerCase();

    if (verb === "help") {
      notify(ctx, USAGE, "info");
      return;
    }
    if (verb === "level") {
      const config = await loadConfig();
      if (parts[1] === "on" || parts[1] === "off") {
        await writeJson(CONFIG_PATH, { ...(await readJson(CONFIG_PATH)) || {}, checkOnStart: parts[1] === "on" });
      }
      const now = await loadConfig();
      notify(ctx, `omp-addons: startup check ${now.checkOnStart ? "on" : "off"}, every ${now.intervalHours}h (${CONFIG_PATH})`, "info");
      return;
    }
    if (verb === "check") {
      await runCheck(ctx);
      return;
    }
    if (verb === "update") {
      await upgrade(pi, ctx, await checkProjects());
      return;
    }
    notify(ctx, renderStatus(await checkProjects()), "info");
  };

  pi.registerCommand("omp-addons", {
    description: "Status, update check and upgrade for the omp-addons set. Usage: /omp-addons <status|check|update|level|help>",
    handler,
  });
  pi.registerCommand("addons", {
    description: "Alias for /omp-addons.",
    handler,
  });

  pi.on("session_start", (_event, ctx) => {
    // Fire and forget: the handler resolves immediately so startup is never gated on GitHub.
    runStartupCheck(pi, ctx).catch(() => {});
  });
}
