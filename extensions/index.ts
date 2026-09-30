/**
 * pi-ark-usage
 *
 * Show Volcengine Ark Coding Plan / Agent Plan usage in the pi TUI, fetched
 * directly from the Ark OpenAPI (`GetCodingPlanUsage`) with AK/SK signing via
 * the official `@volcengine/openapi` Signer. This extension never stores keys:
 * credentials come from VOLC_ACCESSKEY/VOLC_SECRETKEY or ~/.volc/config.
 *
 * Widget (below editor): 火山用量: 会话 4%(...) / 周 34%(...) / 月 17%(...)
 * Commands:
 *   /arkcheck          force refresh
 *   /arkusage          show snapshot in a notification
 *   /arkset ...        view/change settings
 *
 * Design modeled after pi-check-agent-quota: baseline snapshot taken at
 * agent_start, compared at agent_settled to annotate per-round consumption.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { fetchPlan } from "./lib/arkcli.js";
import {
  ArkUsageComponent,
  AUTO_REFRESH_MAX_MINUTES,
  LOCALES,
  buildCompactStatus,
  buildItems,
  formatRemaining,
  getSettings,
  patchSettings,
  resetSettings,
} from "./lib/widget.js";
import {
  flushWrites,
  loadCache,
  markShuttingDown,
  resetShutdownState,
  saveCache,
} from "./lib/cache.js";
import type {
  ArkPeriod,
  ArkSettings,
  Language,
  PlanSnapshot,
  RenderItem,
} from "./lib/types.js";

const WIDGET_KEY = "pi-ark-usage";
/** Extension-status key consumed by pi-powerline-footer (powerline slot). */
const STATUS_KEY = "ark-usage";
const TICK_MS = 60_000;
const AGENT_START_TIMEOUT_MS = 3_000;
const BASELINE_FRESH_MS = 60 * 60_000;

const PRODUCTS = [
  "coding-plan",
  "agent-plan",
  "coding-plan-team",
  "agent-plan-team",
] as const;

type ProductId = (typeof PRODUCTS)[number];

/** provider id (pi models.json) -> plan product id */
const PROVIDER_PRODUCT: Record<string, ProductId> = {
  "coding-plan": "coding-plan",
  "agent-plan": "agent-plan",
  "coding-plan-team": "coding-plan-team",
  "agent-plan-team": "agent-plan-team",
};

type FetchTrigger =
  | "session_start"
  | "model_select"
  | "stale"
  | "settled"
  | "manual";

type Status = "ok" | "fetching" | "failed" | "none";

/* --------------------------------- state ---------------------------------- */

let language: Language = "en";
const snapshots = new Map<string, PlanSnapshot>();
let activeProduct: ProductId | null = null;
let status: Status = "ok";
let deltas: Record<string, number> | null = null;
let note: "changed" | "reset" | null = null;
let baseline: PlanSnapshot | null = null;
let activeWidget: ArkUsageComponent | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let lastCtx: ExtensionContext | null = null;
let lastAutoAt = 0;
let shuttingDown = false;
let inFlight: AbortController | null = null;

/* ----------------------------- product picking ----------------------------- */

function isTeamProduct(p: string): boolean {
  return p.endsWith("-team");
}

/**
 * Resolve the product to display.
 * - forced product setting wins
 * - auto: provider mapping, else first subscribed snapshot
 */
function resolveProduct(ctx: ExtensionContext): ProductId | null {
  const forced = getSettings().product;
  if (forced !== "auto") return forced as ProductId;

  const provider = ctx.model?.provider;
  if (provider && PROVIDER_PRODUCT[provider]) {
    return PROVIDER_PRODUCT[provider];
  }
  for (const p of PRODUCTS) {
    if (snapshots.has(p)) return p;
  }
  return null;
}

function activeSnapshot(): PlanSnapshot | null {
  return activeProduct ? snapshots.get(activeProduct) ?? null : null;
}

/* -------------------------------- rendering -------------------------------- */

function renderWidget(ctx: ExtensionContext): void {
  lastCtx = ctx;
  const snap = activeSnapshot();
  const widgetStatus = status === "ok" && !snap ? "none" : status;
  const items: RenderItem[] = buildItems(
    snap,
    language,
    widgetStatus,
    ctx.isIdle(),
    deltas,
    note,
  );
  // Publish the one-line summary to the extension-status slot (powerline).
  // The ticker calls renderWidget every minute while idle, keeping the
  // reset countdown fresh without refetching.
  const compact = buildCompactStatus(snap, widgetStatus, ctx.ui.theme);
  if (compact) {
    ctx.ui.setStatus(STATUS_KEY, compact);
  } else {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }
  if (activeWidget) {
    activeWidget.update(items);
    return;
  }
  ctx.ui.setWidget(
    WIDGET_KEY,
    (tui, theme) => {
      const component = new ArkUsageComponent(
        items,
        () => theme,
        () => tui.requestRender?.(),
      );
      activeWidget = component;
      return component;
    },
    { placement: "belowEditor" },
  );
}

/* --------------------------------- fetching -------------------------------- */

function toSnapshot(
  product: ProductId,
  periods: ArkPeriod[],
  updatedAt: number | undefined,
): PlanSnapshot {
  return {
    product,
    edition: isTeamProduct(product) ? "team" : "personal",
    fetchedAt: Date.now(),
    periods,
    updatedAt,
  };
}

async function refresh(
  ctx: ExtensionContext,
  trigger: FetchTrigger,
): Promise<boolean> {
  if (shuttingDown) return false;
  const product = resolveProduct(ctx);
  activeProduct = product;
  if (!product) {
    status = "none";
    renderWidget(ctx);
    return false;
  }

  // Coalesce: reuse the in-flight request for the same product.
  if (inFlight) {
    // different product: let the existing one finish naturally; just await nothing
  }

  status = "fetching";
  note = null;
  renderWidget(ctx);

  const controller = new AbortController();
  inFlight = controller;
  lastAutoAt = Date.now();

  const s = getSettings();
  const queryOne = s.product !== "auto";
  try {
    const output = await fetchPlan({
      signal: controller.signal,
      product: queryOne ? product : undefined,
      seat: isTeamProduct(product) ? s.seat || undefined : undefined,
    });

    let updated = 0;
    for (const item of output.items) {
      if (item.subscribed && item.periods && item.periods.length > 0) {
        snapshots.set(
          item.product,
          toSnapshot(
            item.product as ProductId,
            item.periods,
            item.updated_at,
          ),
        );
        updated++;
      }
    }
    status = updated > 0 ? "ok" : "none";
    if (trigger !== "settled") persist();
    return updated > 0;
  } catch {
    // keep the last good snapshot; mark failed only if we have nothing
    status = activeSnapshot() ? "ok" : "failed";
    return false;
  } finally {
    if (inFlight === controller) inFlight = null;
    renderWidget(ctx);
  }
}

function persist(): void {
  const out: Record<string, PlanSnapshot> = {};
  for (const [k, v] of snapshots) out[k] = v;
  saveCache(language, out);
}

/* ---------------------------- baseline / delta ----------------------------- */

function computeDeltas(
  before: PlanSnapshot,
  after: PlanSnapshot,
): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const p of after.periods) {
    const old = before.periods.find((q) => q.label === p.label);
    if (old) out[p.label] = Math.round(old.percent - p.percent);
    // note: stored as consumed-positive; renderer negates for display
  }
  // flip sign convention for renderer: it wants negative=consumed
  const render: Record<string, number> = {};
  for (const [k, v] of Object.entries(out)) render[k] = -v;
  return render;
}

function looksReset(a: PlanSnapshot, b: PlanSnapshot): boolean {
  // all periods dropped sharply at once => plan period reset
  return b.periods.every((p) => {
    const old = a.periods.find((q) => q.label === p.label);
    return old !== undefined && p.percent - old.percent < -30;
  });
}

async function handleStart(ctx: ExtensionContext): Promise<void> {
  const product = resolveProduct(ctx);
  if (!product) return;
  const cached = snapshots.get(product) ?? null;
  if (cached && Date.now() - cached.fetchedAt <= BASELINE_FRESH_MS) {
    baseline = cached;
  } else {
    const win = await timeoutResult(refresh(ctx, "stale"), AGENT_START_TIMEOUT_MS);
    baseline = win ? snapshots.get(product) ?? null : cached;
  }
  deltas = null;
  renderWidget(ctx);
}

async function handleSettled(ctx: ExtensionContext): Promise<void> {
  const product = resolveProduct(ctx);
  if (!product) return;
  const ok = await refresh(ctx, "settled");
  if (!ok) return;
  const snap = snapshots.get(product);
  if (!snap) return;

  if (baseline && baseline.product !== product) {
    note = "changed";
    deltas = null;
  } else if (baseline && looksReset(baseline, snap)) {
    note = "reset";
    deltas = null;
  } else if (baseline) {
    deltas = computeDeltas(baseline, snap);
    note = null;
  }
  baseline = null;
  renderWidget(ctx);
}

async function timeoutResult<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race<T | null>([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* --------------------------------- ticker ---------------------------------- */

function ensureTicker(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    if (!lastCtx || shuttingDown) return;
    const interval = getSettings().autoRefreshMinutes;
    if (
      interval > 0 &&
      Date.now() - lastAutoAt >= interval * 60_000
    ) {
      lastAutoAt = Date.now();
      void refresh(lastCtx, "manual");
      return;
    }
    // age text ticks every minute even without refetch
    if (activeWidget && lastCtx.isIdle()) renderWidget(lastCtx);
  }, TICK_MS);
  tickTimer.unref?.();
}

function stopTicker(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

/* -------------------------------- commands --------------------------------- */

async function cmdCheck(
  _args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const ok = await refresh(ctx, "manual");
  const snap = activeSnapshot();
  const locale = LOCALES[language];
  if (!ok || !snap) {
    ctx.ui.notify(locale.refreshFailed, "warning");
    return;
  }
  const summary = snap.periods
    .map((p) => {
      const label = locale.labels[p.label] ?? p.label;
      return `${label} ${Math.round(p.percent)}%`;
    })
    .join(" / ");
  ctx.ui.notify(locale.refreshOk(summary), "info");
}

async function cmdUsage(
  _args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const snap = activeSnapshot();
  const locale = LOCALES[language];
  if (!snap) {
    ctx.ui.notify(locale.noActiveProduct, "warning");
    return;
  }
  const parts = snap.periods.map((p) => {
    const label = locale.labels[p.label] ?? p.label;
    let line = `${label} ${Math.round(p.percent)}%`;
    if (p.reset_at) {
      const remainMs = new Date(p.reset_at).getTime() - Date.now();
      const t = formatRemaining(remainMs, language);
      if (t) line += `（${locale.resetsIn(t)}）`;
    }
    return line;
  });
  ctx.ui.notify(`${locale.title}: ${parts.join(" / ")}`, "info");
}

async function cmdSet(
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const locale = LOCALES[language];
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const notifySaved = (): void => {
    persist();
    ctx.ui.notify(locale.settingsApplied, "info");
    if (lastCtx) renderWidget(lastCtx);
  };

  if (parts.length === 0) {
    ctx.ui.notify(locale.settingsShow(getSettings()), "info");
    return;
  }

  const [key, raw] = parts;
  switch (key) {
    case "reset": {
      resetSettings();
      persist();
      ctx.ui.notify(locale.settingsReset, "info");
      if (lastCtx) renderWidget(lastCtx);
      return;
    }
    case "yellow":
    case "red": {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || n >= 100 || parts.length !== 2) {
        ctx.ui.notify(locale.settingsUsage, "warning");
        return;
      }
      const s = getSettings();
      if (key === "yellow" && n >= s.pctRed) {
        ctx.ui.notify(locale.settingsUsage, "warning");
        return;
      }
      if (key === "red" && n <= s.pctYellow) {
        ctx.ui.notify(locale.settingsUsage, "warning");
        return;
      }
      patchSettings(key === "yellow" ? { pctYellow: n } : { pctRed: n });
      notifySaved();
      return;
    }
    case "auto": {
      const n = Number(raw);
      if (
        parts.length !== 2 ||
        !Number.isInteger(n) ||
        n < 0 ||
        n > AUTO_REFRESH_MAX_MINUTES
      ) {
        ctx.ui.notify(locale.settingsUsage, "warning");
        return;
      }
      patchSettings({ autoRefreshMinutes: n });
      notifySaved();
      ctx.ui.notify(n > 0 ? locale.autoOn(n) : locale.autoOff, "info");
      return;
    }
    case "product": {
      if (
        parts.length !== 2 ||
        (raw !== "auto" && !PRODUCTS.includes(raw as ProductId))
      ) {
        ctx.ui.notify(locale.settingsUsage, "warning");
        return;
      }
      patchSettings({ product: raw as ArkSettings["product"] });
      notifySaved();
      ctx.ui.notify(locale.productSet(raw), "info");
      void refresh(ctx, "manual");
      return;
    }
    case "seat": {
      if (parts.length === 1 || raw === "none") {
        patchSettings({ seat: "" });
        notifySaved();
        ctx.ui.notify(locale.seatCleared, "info");
        return;
      }
      if (parts.length !== 2 || raw.length > 128) {
        ctx.ui.notify(locale.settingsUsage, "warning");
        return;
      }
      patchSettings({ seat: raw });
      notifySaved();
      ctx.ui.notify(locale.seatSet(raw), "info");
      return;
    }
    case "lang": {
      if (raw !== "zh" && raw !== "en") {
        ctx.ui.notify(locale.settingsUsage, "warning");
        return;
      }
      language = raw;
      persist();
      ctx.ui.notify(locale.languageChanged(language), "info");
      if (lastCtx) renderWidget(lastCtx);
      return;
    }
    default:
      ctx.ui.notify(locale.settingsUsage, "warning");
  }
}

/* --------------------------------- wiring ---------------------------------- */

export default function (pi: ExtensionAPI): void {
  const loaded = loadCache();
  if (loaded) {
    language = loaded.language;
    for (const [k, v] of Object.entries(loaded.snapshots)) {
      snapshots.set(k, v);
    }
  }

  pi.on("session_shutdown", async (event) => {
    stopTicker();
    inFlight?.abort();
    // Only a real quit is terminal. Session switches (/new, /resume, /fork,
    // /reload) tear down and then re-enter session_start in the same process;
    // marking terminal shutdown there would block every future refresh.
    if (event.reason === "quit") {
      shuttingDown = true;
      markShuttingDown();
    }
    await flushWrites();
  });

  pi.on("session_start", (_event, ctx) => {
    // Session switches reuse this module instance in-process: pi has disposed
    // the old TUI widget and torn down the previous runtime, so drop stale
    // handles and revive the shutdown flags before doing anything else.
    shuttingDown = false;
    resetShutdownState();
    activeWidget = null;
    activeProduct = resolveProduct(ctx);
    deltas = null;
    note = null;
    renderWidget(ctx);
    ensureTicker();
    void refresh(ctx, "session_start");
  });

  pi.on("model_select", (_event, ctx) => {
    const next = resolveProduct(ctx);
    if (baseline && next && baseline.product !== next) note = "changed";
    activeProduct = next;
    renderWidget(ctx);
    void refresh(ctx, "model_select");
  });

  pi.on("agent_start", async (_event, ctx) => {
    await handleStart(ctx);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await handleSettled(ctx);
  });

  pi.registerCommand("arkcheck", {
    description: "Force refresh Volcengine Ark plan usage",
    handler: cmdCheck,
  });
  pi.registerCommand("arkusage", {
    description: "Show Volcengine Ark plan usage details",
    handler: cmdUsage,
  });
  pi.registerCommand("arkset", {
    description:
      "View/change ark usage settings: yellow|red|auto|product|seat|lang|reset",
    handler: cmdSet,
  });
}
