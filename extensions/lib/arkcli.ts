/**
 * `arkcli` process wrapper: locate the binary, invoke `arkcli usage plan`,
 * parse and validate its JSON output.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ArkPlanOutput, ArkPlanItem, ArkPeriod } from "./types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_JSON_BYTES = 1024 * 1024;

const PRODUCT_IDS = new Set([
  "coding-plan",
  "agent-plan",
  "coding-plan-team",
  "agent-plan-team",
]);

/** Locate arkcli: explicit env override, else plain name (resolved via PATH). */
export function arkcliBin(): string {
  return process.env.PI_ARK_USAGE_ARKCLI || "arkcli";
}

export async function checkArkcliAvailable(): Promise<boolean> {
  try {
    await execFileAsync(arkcliBin(), ["--help"], { timeout: 5_000 });
    return true;
  } catch {
    // --help may exit non-zero in odd wrappers; fall back to version check.
    try {
      await execFileAsync(arkcliBin(), ["version"], { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validatePeriod(raw: unknown): ArkPeriod | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.label !== "string" || p.label.length === 0) return null;
  if (!isFiniteNumber(p.percent) || p.percent < 0) return null;
  const out: ArkPeriod = {
    label: p.label,
    percent: Math.min(p.percent, 100),
  };
  if (typeof p.reset_at === "string" && p.reset_at.length > 0) {
    out.reset_at = p.reset_at;
  }
  return out;
}

function validateItem(raw: unknown): ArkPlanItem | null {
  if (!raw || typeof raw !== "object") return null;
  const it = raw as Record<string, unknown>;
  if (typeof it.product !== "string" || !PRODUCT_IDS.has(it.product)) return null;
  if (typeof it.edition !== "string") return null;
  const out: ArkPlanItem = {
    product: it.product,
    edition: it.edition,
    subscribed: it.subscribed === true,
  };
  if (typeof it.error === "string") out.error = it.error;
  if (isFiniteNumber(it.updated_at)) out.updated_at = it.updated_at;
  if (Array.isArray(it.periods)) {
    const periods = it.periods
      .map(validatePeriod)
      .filter((p): p is ArkPeriod => p !== null);
    if (periods.length > 0) out.periods = periods;
  }
  return out;
}

/** Parse and validate raw arkcli JSON. Throws on malformed payload. */
export function parsePlanOutput(raw: string): ArkPlanOutput {
  if (raw.length > MAX_JSON_BYTES) throw new Error("arkcli output too large");
  const json: unknown = JSON.parse(raw);
  if (!json || typeof json !== "object") throw new Error("invalid arkcli output");
  const root = json as Record<string, unknown>;
  if (!Array.isArray(root.items)) throw new Error("invalid arkcli output: missing items");
  const items = root.items
    .map(validateItem)
    .filter((it): it is ArkPlanItem => it !== null);
  if (items.length === 0) throw new Error("arkcli returned no usable items");
  const out: ArkPlanOutput = { items };
  if (root.viewer && typeof root.viewer === "object") {
    out.viewer = root.viewer as ArkPlanOutput["viewer"];
  }
  return out;
}

export type FetchPlanOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** specific product id; undefined = auto-discover all subscriptions */
  product?: string;
  seat?: string;
};

/**
 * Run `arkcli usage plan --format json`.
 * Authentication is fully handled by arkcli itself (SSO profiles etc.).
 */
export async function fetchPlan(options: FetchPlanOptions = {}): Promise<ArkPlanOutput> {
  const args = ["usage", "plan", "--format", "json"];
  if (options.product) {
    args.push("--product", options.product);
  }
  if (options.seat) {
    args.push("--seat", options.seat);
  }

  const { stdout } = await execFileAsync(arkcliBin(), args, {
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_JSON_BYTES,
    signal: options.signal,
    // arkcli may print warnings on stderr; they don't fail the call unless exit code != 0.
    windowsHide: true,
  });
  return parsePlanOutput(stdout);
}
