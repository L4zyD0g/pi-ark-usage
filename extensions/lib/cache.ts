/**
 * Durable cache: persists settings and latest snapshots across restarts.
 *
 * File: ~/.pi/agent/pi-ark-usage/cache.json (0600), written via temp-file
 * rename to survive crashes, mirroring pi-check-agent-quota's safe-write
 * approach but simplified.
 */

import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, getSettings, patchSettings } from "./widget.js";
import type {
  ArkSettings,
  DiskCache,
  Language,
  PlanSnapshot,
} from "./types.js";

export const CACHE_DIR = join(homedir(), ".pi", "agent", "pi-ark-usage");
export const CACHE_FILE = join(CACHE_DIR, "cache.json");

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const MAX_BYTES = 256 * 1024;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validateSnapshot(raw: unknown): PlanSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.product !== "string" || typeof s.edition !== "string") return null;
  if (!isFiniteNumber(s.fetchedAt)) return null;
  if (!Array.isArray(s.periods) || s.periods.length === 0) return null;
  const periods = s.periods
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .filter((p) => typeof p.label === "string" && isFiniteNumber(p.percent))
    .map((p) => ({
      label: p.label as string,
      percent: p.percent as number,
      reset_at: typeof p.reset_at === "string" ? p.reset_at : undefined,
    }));
  if (periods.length === 0) return null;
  return {
    product: s.product,
    edition: s.edition,
    fetchedAt: s.fetchedAt,
    periods,
    updatedAt: isFiniteNumber(s.updatedAt) ? s.updatedAt : undefined,
  };
}

function validateSettings(raw: unknown): Partial<ArkSettings> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<ArkSettings> = {};
  if (isFiniteNumber(r.pctYellow) && r.pctYellow > 0 && r.pctYellow < 100) {
    out.pctYellow = r.pctYellow;
  }
  if (isFiniteNumber(r.pctRed) && r.pctRed > 0 && r.pctRed < 100) {
    out.pctRed = r.pctRed;
  }
  if (isFiniteNumber(r.autoRefreshMinutes) && r.autoRefreshMinutes >= 0) {
    out.autoRefreshMinutes = Math.min(30, Math.round(r.autoRefreshMinutes));
  }
  if (
    r.product === "auto" ||
    r.product === "coding-plan" ||
    r.product === "agent-plan" ||
    r.product === "coding-plan-team" ||
    r.product === "agent-plan-team"
  ) {
    out.product = r.product;
  }
  if (typeof r.seat === "string" && r.seat.length <= 128) {
    out.seat = r.seat;
  }
  return out;
}

export type LoadedCache = {
  language: Language;
  snapshots: Record<string, PlanSnapshot>;
};

/** Read & validate cache; applies settings on success. Never throws. */
export function loadCache(): LoadedCache | null {
  let fd: number | undefined;
  try {
    fd = openSync(
      CACHE_FILE,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_BYTES) return null;
    fchmodSync(fd, FILE_MODE);
    const disk = JSON.parse(readFileSync(fd, "utf8")) as DiskCache;
    if (!disk || disk.version !== 1) return null;

    const validated = validateSettings(disk.settings);
    patchSettings({ ...DEFAULT_SETTINGS, ...validated });

    const snapshots: Record<string, PlanSnapshot> = {};
    if (disk.snapshots && typeof disk.snapshots === "object") {
      for (const [k, v] of Object.entries(disk.snapshots)) {
        const s = validateSnapshot(v);
        if (s) snapshots[k] = s;
      }
    }
    return {
      language: disk.language === "en" ? "en" : "zh",
      snapshots,
    };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

let writeQueue: Promise<void> = Promise.resolve();
let pending: string | null = null;
let scheduled = false;
let shuttingDown = false;

/** Schedule an async cache write; multiple rapid calls coalesce into one. */
export function saveCache(
  language: Language,
  snapshots: Record<string, PlanSnapshot>,
): void {
  if (shuttingDown) return;
  pending = JSON.stringify({
    version: 1,
    language,
    settings: getSettings(),
    snapshots,
  } satisfies DiskCache);
  if (scheduled) return;
  scheduled = true;
  writeQueue = writeQueue
    .then(async () => {
      scheduled = false;
      while (pending !== null) {
        const data = pending;
        pending = null;
        await writeFile(data);
      }
    })
    .catch(() => {});
}

export async function flushWrites(): Promise<void> {
  await writeQueue;
}

export function markShuttingDown(): void {
  shuttingDown = true;
}

/** Revive cache writes after an in-process session switch (see index.ts). */
export function resetShutdownState(): void {
  shuttingDown = false;
}

async function writeFile(data: string): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true, mode: DIR_MODE });
  const dir = await lstat(CACHE_DIR);
  if (!dir.isDirectory() || dir.isSymbolicLink()) {
    throw new Error("unsafe cache directory");
  }
  await chmod(CACHE_DIR, DIR_MODE);

  const tmp = `${CACHE_FILE}.${randomUUID()}.tmp`;
  try {
    const handle = await open(tmp, "wx", FILE_MODE);
    try {
      await handle.writeFile(data, { encoding: "utf8" });
    } finally {
      await handle.close();
    }
    await rename(tmp, CACHE_FILE);
    await chmod(CACHE_FILE, FILE_MODE);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
