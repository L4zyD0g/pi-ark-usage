/**
 * Shared types for pi-ark-usage.
 */

export type Language = "zh" | "en";

/** Render model, modeled after pi-check-agent-quota. */
export type RenderItem =
  | { kind: "text"; text: string }
  | { kind: "pct"; pct: number; metric: string }
  | { kind: "annotation"; text: string }
  | { kind: "age"; text: string };

/** User-tunable settings (persisted in the disk cache). */
export type ArkSettings = {
  /** yellow threshold, percent */
  pctYellow: number;
  /** red threshold, percent */
  pctRed: number;
  /** auto refresh interval in minutes; 0 = off */
  autoRefreshMinutes: number;
  /** forced product; "auto" = map from active provider */
  product: "auto" | "coding-plan" | "agent-plan" | "coding-plan-team" | "agent-plan-team";
  /** seat id for team products */
  seat: string;
};

export type PeriodLabel = "session" | "5h" | "weekly" | "monthly";

/** One billing period as returned by `arkcli usage plan`. */
export type ArkPeriod = {
  label: PeriodLabel | string;
  percent: number;
  reset_at?: string;
};

/** One product entry as returned by `arkcli usage plan`. */
export type ArkPlanItem = {
  product: string;
  edition: "personal" | "team" | string;
  subscribed: boolean;
  periods?: ArkPeriod[];
  error?: string;
  updated_at?: number;
};

/** Shape of `arkcli usage plan --format json` output. */
export type ArkPlanOutput = {
  viewer?: {
    auth_method?: string;
    user_name?: string;
    region?: string;
    profile?: string;
    [k: string]: unknown;
  };
  items: ArkPlanItem[];
};

/** Normalized per-product snapshot kept at runtime. */
export type PlanSnapshot = {
  product: string;
  edition: string;
  fetchedAt: number;
  periods: ArkPeriod[];
  updatedAt?: number;
};

export type DiskCache = {
  version: 1;
  language: Language;
  settings: Partial<ArkSettings>;
  snapshots?: Record<string, PlanSnapshot>;
};
