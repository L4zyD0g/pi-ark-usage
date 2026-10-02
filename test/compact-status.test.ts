/** Compact powerline status: format, ordering (session/weekly/monthly), colors. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeMockCtx } from "./helpers.ts";

const {
  buildCompactStatus,
  formatCompactRemaining,
  formatRefreshAgo,
  coloredPct,
  hexFg,
  HEX_COLORS,
  patchSettings,
} = await import("../extensions/lib/widget.ts");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MIN = 60_000;

/** `n` minutes before a fixed clock, for age formatting assertions. */
function MIN_AGO(n: number): number {
  return Date.now() - n * MIN;
}

function snapOf(periods, fetchedAt = Date.now()) {
  return { product: "coding-plan", edition: "personal", fetchedAt, periods };
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

describe("formatRefreshAgo", () => {
  it("counts minutes, then hours, then days, dropping zero lower units", () => {
    assert.equal(formatRefreshAgo(MIN_AGO(3)), "3m ago");
    assert.equal(formatRefreshAgo(MIN_AGO(10)), "10m ago");
    assert.equal(formatRefreshAgo(MIN_AGO(59)), "59m ago");
    assert.equal(formatRefreshAgo(MIN_AGO(60)), "1h ago");
    assert.equal(formatRefreshAgo(MIN_AGO(4 * 60 + 38)), "4h38m ago");
    assert.equal(formatRefreshAgo(MIN_AGO(5 * 1440)), "5d ago");
    assert.equal(formatRefreshAgo(MIN_AGO(5 * 1440 + 4 * 60)), "5d4h ago");
  });

  it("collapses anything under a minute to 'just now', including clock skew", () => {
    assert.equal(formatRefreshAgo(MIN_AGO(0)), "just now");
    assert.equal(formatRefreshAgo(Date.now() - 59_999), "just now");
    assert.equal(formatRefreshAgo(MIN_AGO(-5)), "just now");
  });

  it("returns empty for zero/invalid", () => {
    assert.equal(formatRefreshAgo(0), "");
    assert.equal(formatRefreshAgo(Number.NaN), "");
  });
});

describe("buildCompactStatus", () => {
  // Fixed clock: buildCompactStatus takes `now` so the countdowns and the
  // refresh-age segment are fully deterministic in tests.
  const NOW = new Date(2026, 8, 30, 15, 12).getTime();
  // 5 minutes before NOW.
  const FETCHED = new Date(2026, 8, 30, 15, 7).getTime();

  it("joins periods in API order (session/weekly/monthly) with pink separators", () => {
    patchSettings({ pctYellow: 50, pctRed: 80 });
    const snap = snapOf(
      [
        { label: "session", percent: 1, reset_at: NOW + 4 * HOUR + 38 * 60_000 },
        { label: "weekly", percent: 15, reset_at: NOW + 5 * DAY + 4 * HOUR },
        { label: "monthly", percent: 54, reset_at: NOW + 23 * DAY + 4 * HOUR },
      ],
      FETCHED,
    );
    const sep = hexFg(HEX_COLORS.pink, " | ");
    const expected =
      `${hexFg(HEX_COLORS.green, "1%")} ${hexFg(HEX_COLORS.purple, "4h38m")}` +
      sep +
      `${hexFg(HEX_COLORS.green, "15%")} ${hexFg(HEX_COLORS.purple, "5d4h")}` +
      sep +
      `${hexFg(HEX_COLORS.yellow, "54%")} ${hexFg(HEX_COLORS.purple, "23d4h")}` +
      // trailing segment: pink separator + pink age of the last refresh
      `${sep}${hexFg(HEX_COLORS.pink, "5m ago")}`;
    assert.equal(buildCompactStatus(snap, "ok", NOW), expected);
  });

  it("reports the refresh age across days without extra units", () => {
    const snap = snapOf(
      [{ label: "session", percent: 10, reset_at: NOW + 60 * 60_000 }],
      new Date(2026, 8, 29, 23, 59).getTime(),
    );
    assert.equal(
      buildCompactStatus(snap, "ok", NOW),
      `${hexFg(HEX_COLORS.green, "10%")} ${hexFg(HEX_COLORS.purple, "1h0m")}` +
        `${hexFg(HEX_COLORS.pink, " | ")}${hexFg(HEX_COLORS.pink, "15h13m ago")}`,
    );
  });

  it("applies 50/80 thresholds to the percent color", () => {
    patchSettings({ pctYellow: 50, pctRed: 80 });
    assert.equal(coloredPct(49), hexFg(HEX_COLORS.green, "49%"));
    assert.equal(coloredPct(50), hexFg(HEX_COLORS.yellow, "50%"));
    assert.equal(coloredPct(79), hexFg(HEX_COLORS.yellow, "79%"));
    assert.equal(coloredPct(80), hexFg(HEX_COLORS.red, "80%"));
  });

  it("omits the reset countdown when reset_at is missing (keeps refresh age)", () => {
    const now = new Date(2026, 8, 30, 15, 12).getTime();
    const snap = snapOf(
      [{ label: "session", percent: 10, reset_at: undefined }],
      new Date(2026, 8, 30, 15, 7).getTime(),
    );
    assert.equal(
      buildCompactStatus(snap, "ok", now),
      `${hexFg(HEX_COLORS.green, "10%")}` +
        `${hexFg(HEX_COLORS.pink, " | ")}${hexFg(HEX_COLORS.pink, "5m ago")}`,
    );
  });

  it("shows placeholders for transient states and null when idle-empty", () => {
    assert.equal(buildCompactStatus(null, "fetching"), hexFg(HEX_COLORS.purple, "…"));
    assert.equal(buildCompactStatus(null, "failed"), hexFg(HEX_COLORS.red, "failed"));
    assert.equal(buildCompactStatus(null, "none"), null);
    assert.equal(buildCompactStatus(null, "ok"), null);
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
      // separators use the pink model-name color (#D787AF = 215;135;175)
      assert.match(value, /\x1B\[38;2;215;135;175m \| \x1B\[39m/);
      // trailing segment is the age of the last successful refresh, in the
      // pink used for the separators (#D787AF = 215;135;175)
      assert.match(value, /\x1B\[38;2;215;135;175m(just now|\d+[mhd]\w* ago)\x1B\[39m$/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
