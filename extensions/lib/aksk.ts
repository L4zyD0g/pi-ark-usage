/**
 * Volcengine Ark OpenAPI client (AK/SK).
 *
 * Replaces the old `arkcli` subprocess wrapper: usage is fetched directly
 * from the Ark OpenAPI (`GetCodingPlanUsage`) using the official
 * `@volcengine/openapi` Signer for V4 request signing.
 *
 * Credential resolution (no secrets are ever logged or persisted here):
 *   1. env: VOLC_ACCESSKEY / VOLC_SECRETKEY (+ optional VOLC_SESSION_TOKEN)
 *   2. ~/.volc/config — JSON {"VOLC_ACCESSKEY": "...", "VOLC_SECRETKEY": "..."}
 *      (the same default path the official SDK uses)
 */

import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Signer } from "@volcengine/openapi";
import type { ArkPlanItem, ArkPlanOutput, ArkPeriod } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_JSON_BYTES = 1024 * 1024;

const OPEN_HOST = "open.volcengineapi.com";
const REGION = "cn-beijing";
const SERVICE = "ark";
const ARK_VERSION = "2024-01-01";
const USAGE_ACTION = "GetCodingPlanUsage";

/** Product id reported for this API. The Ark OpenAPI exposes the coding plan usage of the AK/SK account. */
const REPORTED_PRODUCT = "coding-plan";

export type { ArkPlanOutput };

export type FetchPlanOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** accepted for interface compatibility; the OpenAPI has no product/seat filter */
  product?: string;
  seat?: string;
};

type Credentials = {
  accessKeyId: string;
  secretKey: string;
  sessionToken?: string;
};

let cachedCreds: Credentials | null | undefined;

function readEnvCreds(): Credentials | null {
  const ak = process.env.VOLC_ACCESSKEY;
  const sk = process.env.VOLC_SECRETKEY;
  if (!ak || !sk) return null;
  return {
    accessKeyId: ak,
    secretKey: sk,
    sessionToken: process.env.VOLC_SESSION_TOKEN || undefined,
  };
}

async function readConfigFileCreds(): Promise<Credentials | null> {
  const path = join(homedir(), ".volc", "config");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON in ${path}`);
  }
  if (!json || typeof json !== "object") return null;
  const cfg = json as Record<string, unknown>;
  const ak = cfg.VOLC_ACCESSKEY ?? cfg.AccessKeyId;
  const sk = cfg.VOLC_SECRETKEY ?? cfg.SecretAccessKey;
  if (typeof ak !== "string" || typeof sk !== "string" || !ak || !sk) {
    return null;
  }
  const token = cfg.VOLC_SESSIONTOKEN ?? cfg.SessionToken;
  return {
    accessKeyId: ak,
    secretKey: sk,
    sessionToken: typeof token === "string" && token ? token : undefined,
  };
}

/** Resolve credentials once per process; null = none found anywhere. */
export async function resolveCredentials(): Promise<Credentials | null> {
  if (cachedCreds !== undefined) return cachedCreds;
  cachedCreds = readEnvCreds() ?? (await readConfigFileCreds());
  return cachedCreds;
}

export async function checkCredentialsAvailable(): Promise<boolean> {
  return (await resolveCredentials()) !== null;
}

/* ------------------------------- response types ------------------------------ */

type QuotaEntry = {
  Level?: unknown;
  Percent?: unknown;
  ResetTimestamp?: unknown;
  [k: string]: unknown;
};

type UsageResponse = {
  ResponseMetadata?: {
    Error?: { Code?: unknown; Message?: unknown; [k: string]: unknown };
    [k: string]: unknown;
  };
  Result?: {
    Status?: unknown;
    UpdateTimestamp?: unknown;
    QuotaUsage?: QuotaEntry[];
    [k: string]: unknown;
  };
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function fmtReset(sec: number): string {
  // API returns epoch seconds; render as ISO 8601 in UTC+8 for readability.
  const tz = new Date(sec * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(tz);
  const get = (t: string): string =>
    parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+08:00`;
}

function validatePeriod(raw: QuotaEntry): ArkPeriod | null {
  if (!isFiniteNumber(raw.Percent) || raw.Percent < 0) return null;
  const label =
    typeof raw.Level === "string" && raw.Level.length > 0
      ? raw.Level
      : "unknown";
  const out: ArkPeriod = {
    label,
    percent: Math.min(raw.Percent, 100),
  };
  if (isFiniteNumber(raw.ResetTimestamp) && raw.ResetTimestamp > 0) {
    out.reset_at = fmtReset(raw.ResetTimestamp);
  }
  return out;
}

function itemFromResponse(
  res: UsageResponse,
): { item: ArkPlanItem } | { error: string } {
  const apiError = res.ResponseMetadata?.Error;
  if (apiError) {
    const code = typeof apiError.Code === "string" ? apiError.Code : "Unknown";
    const msg =
      typeof apiError.Message === "string" ? apiError.Message : "API error";
    return { error: `${code}: ${msg}` };
  }
  const result = res.Result;
  if (!result || typeof result !== "object") {
    return { error: "invalid response: missing Result" };
  }
  const entries = Array.isArray(result.QuotaUsage) ? result.QuotaUsage : [];
  const periods = entries
    .map(validatePeriod)
    .filter((p): p is ArkPeriod => p !== null);
  if (periods.length === 0) {
    return { error: "response has no usable quota periods" };
  }
  const item: ArkPlanItem = {
    product: REPORTED_PRODUCT,
    edition: "personal",
    subscribed: true,
    periods,
  };
  if (isFiniteNumber(result.UpdateTimestamp) && result.UpdateTimestamp > 0) {
    item.updated_at = result.UpdateTimestamp * 1000;
  }
  return { item };
}

/** Parse and validate the raw OpenAPI JSON. Throws on malformed payload. */
export function parseUsageResponse(raw: string): ArkPlanOutput {
  if (raw.length > MAX_JSON_BYTES) throw new Error("API response too large");
  let json: UsageResponse;
  try {
    json = JSON.parse(raw) as UsageResponse;
  } catch {
    throw new Error("invalid API response: not JSON");
  }
  if (!json || typeof json !== "object") {
    throw new Error("invalid API response");
  }
  const r = itemFromResponse(json);
  if ("error" in r) throw new Error(r.error);
  return { items: [r.item] };
}

/* --------------------------------- fetching ---------------------------------- */

/**
 * Query `GetCodingPlanUsage` via AK/SK-signed OpenAPI request.
 * Throws on missing credentials, transport errors, API errors or unusable data.
 */
export async function fetchPlan(
  options: FetchPlanOptions = {},
): Promise<ArkPlanOutput> {
  const creds = await resolveCredentials();
  if (!creds) {
    throw new Error(
      "no Volcengine credentials: set VOLC_ACCESSKEY/VOLC_SECRETKEY or create ~/.volc/config",
    );
  }

  const body = "{}";
  const request = {
    region: REGION,
    method: "POST" as const,
    pathname: "/",
    params: { Action: USAGE_ACTION, Version: ARK_VERSION },
    headers: { "Content-Type": "application/json" } as Record<string, string>,
    body,
  };
  new Signer(request, SERVICE).addAuthorization({
    accessKeyId: creds.accessKeyId,
    secretKey: creds.secretKey,
    sessionToken: creds.sessionToken ?? "",
  });

  const query = new URLSearchParams(request.params).toString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = options.signal ?? AbortSignal.timeout(timeoutMs);

  let res: Response;
  try {
    res = await fetch(`https://${OPEN_HOST}/?${query}`, {
      method: "POST",
      headers: request.headers,
      body,
      signal,
    });
  } catch (e) {
    throw new Error(`request failed: ${(e as Error).message}`);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return parseUsageResponse(text);
}
