/**
 * Rendering: locales, threshold settings, percent coloring, remaining-time
 * formatting, and the TUI Component for the below-editor widget.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ArkSettings, Language, PlanSnapshot, RenderItem } from "./types.js";

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
  ageNow: string;
  ageMinutesAgo: (m: number) => string;
  ageHoursAgo: (h: number, m: number) => string;
  ageDaysAgo: (d: number, h: number) => string;
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
  ageNow: "刚刚",
  ageMinutesAgo: (m) => `${m}分钟前`,
  ageHoursAgo: (h, m) => (m > 0 ? `${h}小时${m}分前` : `${h}小时前`),
  ageDaysAgo: (d, h) => (h > 0 ? `${d}天${h}小时前` : `${d}天前`),
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
  ageNow: "now",
  ageMinutesAgo: (m) => `${m}m ago`,
  ageHoursAgo: (h, m) => (m > 0 ? `${h}h${m}m ago` : `${h}h ago`),
  ageDaysAgo: (d, h) => (h > 0 ? `${d}d${h}h ago` : `${d}d ago`),
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
  pctYellow: 40,
  pctRed: 80,
  autoRefreshMinutes: 0,
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

export function formatAge(fetchedAt: number, lang: Language): string {
  const age = Date.now() - fetchedAt;
  if (!Number.isFinite(age) || age < 0) return "";
  if (age < 60_000) return LOCALES[lang].ageNow;
  const totalMin = Math.floor(age / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const d = Math.floor(h / 24);
  if (d > 0) return LOCALES[lang].ageDaysAgo(d, h % 24);
  if (h > 0) return LOCALES[lang].ageHoursAgo(h, m);
  return LOCALES[lang].ageMinutesAgo(m);
}

/* ----------------------------- snapshot -> items --------------------------- */

export type WidgetStatus = "ok" | "fetching" | "failed" | "no-binary" | "none";

export function buildItems(
  snapshot: PlanSnapshot | null,
  lang: Language,
  status: WidgetStatus,
  isIdle: boolean,
  /** delta annotations keyed by period label; negative = consumed */
  deltas: Record<string, number> | null,
  note?: "changed" | "reset" | null,
): RenderItem[] {
  const locale = LOCALES[lang];
  const items: RenderItem[] = [];

  if (snapshot && snapshot.periods.length > 0) {
    items.push({ kind: "text", text: `${locale.title}: ` });
    snapshot.periods.forEach((p, i) => {
      if (i > 0) items.push({ kind: "text", text: " / " });
      const label = locale.labels[p.label] ?? p.label;
      items.push({ kind: "text", text: `${label} ` });
      items.push({ kind: "pct", pct: clampPct(p.percent), metric: p.label });
      const delta = deltas?.[p.label];
      if (typeof delta === "number" && delta !== 0) {
        const sign = delta > 0 ? "+" : "-";
        items.push({ kind: "annotation", text: `(${sign}${Math.abs(Math.round(delta))})` });
      }
      if (p.reset_at) {
        const remaining = new Date(p.reset_at).getTime() - Date.now();
        const t = formatRemaining(remaining, lang);
        if (t) items.push({ kind: "annotation", text: `(${locale.resetsIn(t)})` });
      }
    });
  } else if (status === "fetching") {
    items.push({ kind: "text", text: `${locale.title}: ` });
    items.push({ kind: "annotation", text: locale.fetching });
  } else if (status === "failed") {
    items.push({ kind: "text", text: `${locale.title}: ` });
    items.push({ kind: "annotation", text: locale.failed });
  } else if (status === "no-binary") {
    items.push({ kind: "annotation", text: locale.noBinary });
  } else {
    items.push({ kind: "annotation", text: locale.noData });
  }

  if (!isIdle) {
    items.push({ kind: "annotation", text: ` (${locale.using})` });
  } else if (note) {
    items.push({ kind: "annotation", text: ` (${note === "reset" ? locale.reset : locale.changed})` });
  }

  if (snapshot) {
    items.push({ kind: "age", text: formatAge(snapshot.fetchedAt, lang) });
  }
  return items;
}

export function formatItems(items: RenderItem[], theme: Theme): string {
  return items
    .map((it) => {
      switch (it.kind) {
        case "text":
          return theme.fg("dim", it.text);
        case "pct":
          return coloredPct(it.pct);
        case "age":
          return theme.fg("dim", it.text);
        case "annotation":
        default:
          return hexFg(HEX_COLORS.purple, it.text);
      }
    })
    .join("");
}

/* ------------------------------ ansi helpers ------------------------------ */

export const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function visibleWidth(s: string): number {
  let w = 0;
  for (const ch of s.replace(ANSI_RE, "")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    if (cp >= 0x0300 && cp <= 0x036f) continue;
    w +=
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f9ff)
        ? 2
        : 1;
  }
  return w;
}

export function truncateAnsi(s: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (visibleWidth(s) <= maxWidth) return s;
  const budget = maxWidth - 1;
  let out = "";
  let w = 0;
  let i = 0;
  while (i < s.length) {
    ANSI_RE.lastIndex = i;
    const m = ANSI_RE.exec(s);
    if (m && m.index === i) {
      out += m[0];
      i = ANSI_RE.lastIndex;
      continue;
    }
    const ch = String.fromCodePoint(s.codePointAt(i) ?? 0);
    const cw = visibleWidth(ch);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
    i += ch.length;
  }
  return `${out}…\x1b[0m`;
}

export function itemsEqual(a: RenderItem[], b: RenderItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((it, i) => {
    const o = b[i];
    if (it.kind !== o.kind) return false;
    switch (it.kind) {
      case "pct":
        return (
          o.kind === "pct" && it.pct === o.pct && it.metric === o.metric
        );
      case "text":
        return o.kind === "text" && it.text === o.text;
      case "age":
        return o.kind === "age" && it.text === o.text;
      case "annotation":
        return o.kind === "annotation" && it.text === o.text;
    }
  });
}

/* -------------------------------- component -------------------------------- */

export interface Component {
  render(width: number): string[];
  invalidate(): void;
  dispose?(): void;
}

/**
 * Widget rendered below the editor. The age segment is right-aligned and the
 * content wraps to two lines when the terminal is too narrow.
 */
export class ArkUsageComponent implements Component {
  private items: RenderItem[];
  private readonly themeRef: () => Theme;
  private readonly requestRender: () => void;
  private cache: { width: number; lines: string[] } | null = null;
  private disposed = false;

  constructor(
    items: RenderItem[],
    themeRef: () => Theme,
    requestRender: () => void,
  ) {
    this.items = items;
    this.themeRef = themeRef;
    this.requestRender = requestRender;
  }

  update(items: RenderItem[]): void {
    if (this.disposed || itemsEqual(this.items, items)) return;
    this.items = items;
    this.invalidate();
    this.requestRender();
  }

  invalidate(): void {
    this.cache = null;
  }

  render(width: number): string[] {
    if (this.cache && this.cache.width === width) return this.cache.lines;
    const theme = this.themeRef();

    const ageIdx = this.items.findIndex((it) => it.kind === "age");
    if (ageIdx === -1) {
      const text = formatItems(this.items, theme);
      const lines = text ? [truncateAnsi(text, width)] : [];
      this.cache = { width, lines };
      return lines;
    }

    const leftText = formatItems(this.items.slice(0, ageIdx), theme);
    const rightText = formatItems(this.items.slice(ageIdx), theme);
    const lw = visibleWidth(leftText);
    const rw = visibleWidth(rightText);

    let lines: string[];
    if (lw + rw + 1 <= width) {
      lines = [leftText + " ".repeat(width - lw - rw) + rightText];
    } else {
      lines = [
        leftText ? truncateAnsi(leftText, width) : "",
        rw <= width ? " ".repeat(Math.max(0, width - rw)) + rightText : truncateAnsi(rightText, width),
      ].filter((l) => l !== "");
    }
    this.cache = { width, lines };
    return lines;
  }

  dispose(): void {
    this.disposed = true;
    this.cache = null;
  }
}
