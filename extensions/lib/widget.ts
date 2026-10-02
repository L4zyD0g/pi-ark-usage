/**
 * Rendering for the powerline extension-status slot: locales, threshold
 * settings, percent coloring, remaining-time formatting, and the compact
 * colored one-line summary published via `ctx.ui.setStatus`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ArkSettings, Language, PlanSnapshot } from "./types.js";

/* ---------------------------------- i18n ---------------------------------- */

type Locale = {
  title: string;
  labels: Record<string, string>;
  fetching: string;
  failed: string;
  noBinary: string;
  notSubscribed: string;
  noData: string;
  using: string;
  changed: string;
  reset: string;
  resetsIn: (t: string) => string;
  noActiveProduct: string;
  settingsShow: (s: ArkSettings) => string;
  settingsApplied: string;
  settingsReset: string;
  settingsUsage: string;
  autoOn: (m: number) => string;
  autoOff: string;
  languageChanged: (l: Language) => string;
  productSet: (p: string) => string;
  seatSet: (s: string) => string;
  seatCleared: string;
  refreshOk: (summary: string) => string;
  refreshFailed: string;
};

const ZH: Locale = {
  title: "火山用量",
  labels: {
    session: "会话",
    "5h": "5h",
    weekly: "周",
    monthly: "月",
  },
  fetching: "请求中",
  failed: "失败",
  noBinary: "未配置火山 AK/SK 凭据",
  notSubscribed: "未订阅",
  noData: "暂无数据",
  using: "使用中",
  changed: "变更",
  reset: "已重置",
  resetsIn: (t) => `${t}后重置`,
  noActiveProduct: "当前没有可查询的火山套餐",
  settingsShow: (s) =>
    `当前设置：产品=${s.product} 黄线=${s.pctYellow} 红线=${s.pctRed} 自动刷新=${s.autoRefreshMinutes}分钟 seat=${s.seat || "无"}`,
  settingsApplied: "设置已保存",
  settingsReset: "已恢复默认设置",
  settingsUsage:
    "用法：/arkset <yellow|red|auto|product|seat|reset> ...，如 /arkset red 80、/arkset product coding-plan、/arkset auto 5、/arkset reset",
  autoOn: (m) => `自动刷新已开启：每 ${m} 分钟`,
  autoOff: "自动刷新已关闭",
  languageChanged: (l) => `语言已切换为${l === "zh" ? "中文" : "英文"}`,
  productSet: (p) => `产品已切换为 ${p}`,
  seatSet: (s) => `seat 已设置为 ${s}`,
  seatCleared: "seat 已清除",
  refreshOk: (summary) => `用量已刷新：${summary}`,
  refreshFailed: "用量刷新失败",
};

const EN: Locale = {
  title: "Volc Usage",
  labels: {
    session: "sess",
    "5h": "5h",
    weekly: "wk",
    monthly: "mo",
  },
  fetching: "fetching",
  failed: "failed",
  noBinary: "Volcengine AK/SK credentials not configured",
  notSubscribed: "not subscribed",
  noData: "no data",
  using: "using",
  changed: "changed",
  reset: "reset",
  resetsIn: (t) => `reset after ${t}`,
  noActiveProduct: "No active Volcengine plan",
  settingsShow: (s) =>
    `Settings: product=${s.product} yellow=${s.pctYellow} red=${s.pctRed} autoRefresh=${s.autoRefreshMinutes}m seat=${s.seat || "none"}`,
  settingsApplied: "Settings saved",
  settingsReset: "Settings reset to defaults",
  settingsUsage:
    "Usage: /arkset <yellow|red|auto|product|seat|reset> ..., e.g. /arkset red 80, /arkset product coding-plan, /arkset auto 5, /arkset reset",
  autoOn: (m) => `Auto refresh enabled: every ${m} min`,
  autoOff: "Auto refresh disabled",
  languageChanged: (l) => `Language switched to ${l === "zh" ? "Chinese" : "English"}`,
  productSet: (p) => `Product switched to ${p}`,
  seatSet: (s) => `Seat set to ${s}`,
  seatCleared: "Seat cleared",
  refreshOk: (summary) => `Usage refreshed: ${summary}`,
  refreshFailed: "Failed to refresh usage",
};

export const LOCALES: Record<Language, Locale> = { zh: ZH, en: EN };

/* -------------------------------- settings -------------------------------- */

export const AUTO_REFRESH_MAX_MINUTES = 30;

export const DEFAULT_SETTINGS: ArkSettings = {
  pctYellow: 50,
  pctRed: 80,
  autoRefreshMinutes: 5,
  product: "auto",
  seat: "",
};

let settings: ArkSettings = { ...DEFAULT_SETTINGS };

export function getSettings(): Readonly<ArkSettings> {
  return settings;
}

export function patchSettings(patch: Partial<ArkSettings>): Readonly<ArkSettings> {
  settings = { ...settings, ...patch };
  return settings;
}

export function resetSettings(): Readonly<ArkSettings> {
  settings = { ...DEFAULT_SETTINGS };
  return settings;
}

/* --------------------------------- colors --------------------------------- */

export const HEX_COLORS = {
  green: "#1FA87A",
  yellow: "#F09A3E",
  red: "#EE7A5F",
  purple: "#7A5FD0",
} as const;

export function hexFg(hex: string, text: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function pctText(pct: number): string {
  return `${Math.round(pct)}%`;
}

export function coloredPct(pct: number): string {
  const t = pctText(pct);
  if (pct >= settings.pctRed) return hexFg(HEX_COLORS.red, t);
  if (pct >= settings.pctYellow) return hexFg(HEX_COLORS.yellow, t);
  return hexFg(HEX_COLORS.green, t);
}

/* --------------------------------- time fmt -------------------------------- */

export function clampPct(pct: unknown): number {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function formatRemaining(ms: number, lang: Language): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (lang === "zh") {
    if (d > 0) return h > 0 ? `${d}天${h}小时` : `${d}天`;
    if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`;
    return `${m}分钟`;
  }
  if (d > 0) return h > 0 ? `${d}d${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  return `${m}m`;
}

/* ---------------------- compact status (powerline slot) -------------------- */

/**
 * Compact reset countdown for the powerline status: `38m`, `4h38m`, `5d4h`.
 * Lower-precision units are dropped to keep the line short and stable.
 */
export function formatCompactRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

/**
 * Age of the last successful refresh, for the trailing status segment:
 * `just now`, `3m ago`, `4h38m ago`, `5d4h ago`. Minute is the finest unit —
 * seconds would only make the line jitter — and a stale cached snapshot thus
 * reads as old at a glance.
 */
export function formatRefreshAgo(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const ms = now - ts;
  // Clock skew can make a fresh fetch look negative; treat it as "now".
  if (ms < 60_000) return "just now";
  // Drop a zero lower unit (`1h0m` -> `1h`, `5d0h` -> `5d`).
  const age = formatCompactRemaining(ms).replace(/([dh])0[mh]$/, "$1");
  return `${age} ago`;
}

/**
 * One-line colored summary for the powerline extension-status slot:
 * `1% 4h38m | 15% 5d4h | 54% 23d4h | 3m ago`
 *
 * Periods are shown in API order (session / weekly / monthly) without
 * labels — the order itself is the convention. Percent follows the
 * yellow/red thresholds (green below yellow, yellow below red, red at/above
 * red); the time part is always purple; the ` | ` separator uses the
 * editor border color (`thinkingHigh`, pink in the dark theme).
 *
 * The last segment is how long ago the data was fetched, in `dim` — it is
 * meta information, not usage, so it stays visually secondary.
 *
 * Returns null when nothing should be shown (the powerline item hides).
 */
export function buildCompactStatus(
  snapshot: PlanSnapshot | null,
  status: WidgetStatus,
  theme: Theme,
  now: number = Date.now(),
): string | null {
  if (snapshot && snapshot.periods.length > 0) {
    const sep = theme.fg("thinkingHigh", " | ");
    const periods = snapshot.periods
      .map((p) => {
        const pct = coloredPct(clampPct(p.percent));
        const reset = p.reset_at
          ? formatCompactRemaining(new Date(p.reset_at).getTime() - now)
          : "";
        return reset ? `${pct} ${hexFg(HEX_COLORS.purple, reset)}` : pct;
      })
      .join(sep);
    const refreshed = formatRefreshAgo(snapshot.fetchedAt, now);
    return refreshed
      ? `${periods}${sep}${theme.fg("dim", refreshed)}`
      : periods;
  }
  if (status === "fetching") return hexFg(HEX_COLORS.purple, "…");
  if (status === "failed") return hexFg(HEX_COLORS.red, "failed");
  return null;
}

/** Lifecycle states mirrored in the compact status. */
export type WidgetStatus = "ok" | "fetching" | "failed" | "no-binary" | "none";
