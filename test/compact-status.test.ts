/** Compact powerline status: format, ordering (session/weekly/monthly), colors. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeMockCtx } from "./helpers.ts";

const {
  buildCompactStatus,
  formatCompactRemaining,
  coloredPct,
  hexFg,
  HEX_COLORS,
  patchSettings,
} = await import("../extensions/lib/widget.ts");

// `theme` stub: fg(color, text) -> `[color]text`
const theme = {
  fg: (color, text) => `[${color}]${text}`,
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function snapOf(periods) {
  return { product: "coding-plan", edition: "personal", fetchedAt: Date.now(), periods };
}

describe("formatCompactRemaining", () => {
  it("formats minutes/hours/days with lower units dropped", () => {
    assert.equal(formatCompactRemaining(38 * 60_000), "38m");
    assert.equal(formatCompactRemaining(4 * HOUR + 38 * 60_000), "4h38m");
    assert.equal(formatCompactRemaining(5 * DAY + 4 * HOUR), "5d4h");
    assert.equal(formatCompactRemaining(23 * DAY + 4 * HOUR), "23d4h");
  });

  it("returns empty for zero/negative/invalid", () => {
    assert.equal(formatCompactRemaining(0), "");
    assert.equal(formatCompactRemaining(-1000), "");
    assert.equal(formatCompactRemaining(Number.NaN), "");
  });
});

describe("buildCompactStatus", () => {
  it("joins periods in API order (session/weekly/monthly) with colored separator", () => {
    patchSettings({ pctYellow: 50, pctRed: 80 });
    const now = Date.now();
    const snap = snapOf([
      { label: "session", percent: 1, reset_at: now + 4 * HOUR + 39 * 60_000 },
      { label: "weekly", percent: 15, reset_at: now + 5 * DAY + 4 * HOUR + 60_000 },
      { label: "monthly", percent: 54, reset_at: now + 23 * DAY + 4 * HOUR + 60_000 },
    ]);
    // +1min margin so test-execution delay cannot floor the countdown
    // into the lower unit (4h39m+ stays 4h38m+; recompute expected below).
    const expected =
      `${hexFg(HEX_COLORS.green, "1%")} ${hexFg(HEX_COLORS.purple, "4h38m")}` +
      `${theme.fg("thinkingHigh", " | ")}` +
      `${hexFg(HEX_COLORS.green, "15%")} ${hexFg(HEX_COLORS.purple, "5d4h")}` +
      `${theme.fg("thinkingHigh", " | ")}` +
      `${hexFg(HEX_COLORS.yellow, "54%")} ${hexFg(HEX_COLORS.purple, "23d4h")}`;
    assert.equal(buildCompactStatus(snap, "ok", theme), expected);
  });

  it("applies 50/80 thresholds to the percent color", () => {
    patchSettings({ pctYellow: 50, pctRed: 80 });
    assert.equal(coloredPct(49), hexFg(HEX_COLORS.green, "49%"));
    assert.equal(coloredPct(50), hexFg(HEX_COLORS.yellow, "50%"));
    assert.equal(coloredPct(79), hexFg(HEX_COLORS.yellow, "79%"));
    assert.equal(coloredPct(80), hexFg(HEX_COLORS.red, "80%"));
  });

  it("omits the time part when reset_at is missing", () => {
    const snap = snapOf([{ label: "session", percent: 10, reset_at: undefined }]);
    assert.equal(
      buildCompactStatus(snap, "ok", theme),
      `${hexFg(HEX_COLORS.green, "10%")}`,
    );
  });

  it("shows placeholders for transient states and null when idle-empty", () => {
    assert.equal(buildCompactStatus(null, "fetching", theme), hexFg(HEX_COLORS.purple, "…"));
    assert.equal(buildCompactStatus(null, "failed", theme), hexFg(HEX_COLORS.red, "failed"));
    assert.equal(buildCompactStatus(null, "none", theme), null);
    assert.equal(buildCompactStatus(null, "ok", theme), null);
  });
});

describe("extension status publication", () => {
  it("renderWidget publishes the compact status under ark-usage", async () => {
    process.env.VOLC_ACCESSKEY = "test-ak";
    process.env.VOLC_SECRETKEY = "test-sk";
    const body = JSON.stringify({
      ResponseMetadata: { RequestId: "test" },
      Result: {
        Status: "ok",
        UpdateTimestamp: 1_758_000_000,
        QuotaUsage: [
          { Level: "session", Percent: 1, ResetTimestamp: Math.floor((Date.now() + 4 * HOUR) / 1000) },
          { Level: "weekly", Percent: 15, ResetTimestamp: Math.floor((Date.now() + 5 * DAY) / 1000) },
          { Level: "monthly", Percent: 54, ResetTimestamp: Math.floor((Date.now() + 23 * DAY) / 1000) },
        ],
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(body, { status: 200 }));

    try {
      const { default: createExtension } = await import("../extensions/index.ts");
      const { makeMockPi, waitFor } = await import("./helpers.ts");
      const api = makeMockPi();
      createExtension(api);
      const scene = makeMockCtx();
      await api.fire("session_start", { type: "session_start", reason: "startup" }, scene.ctx);
      // Wait past the transient “…” (fetching) placeholder for the real summary.
      try {
        await waitFor(() => (scene.statuses.get("ark-usage") ?? "").includes("|"));
      } catch (err) {
        assert.fail(
          `status never settled; statuses=${JSON.stringify([...scene.statuses])} notifications=${JSON.stringify(scene.notifications)} err=${err}`,
        );
      }
      const value = scene.statuses.get("ark-usage");
      assert.match(value, /1%.* \| .*15%.* \| .*54%/);
      // separator went through theme.fg (mock renders as `[fg] | `)
      assert.match(value, /\] \| /);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
