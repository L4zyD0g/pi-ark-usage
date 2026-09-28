/** Regression: after `/new` the widget must be re-registered and refresh must resume. */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  makeMockPi,
  makeMockCtx,
  stubFetch,
  waitFor,
} from "./helpers.ts";

const { default: createExtension } = await import("../extensions/index.ts");

describe("/new session switch", () => {
  let restoreFetch;
  let counter;

  beforeEach(() => {
    counter = { count: 0 };
    restoreFetch = stubFetch(counter);
  });
  afterEach(() => restoreFetch());

  it("re-registers the widget and keeps fetching after /new", async () => {
    const api = makeMockPi();
    createExtension(api);

    const s1 = makeMockCtx();
    await api.fire("session_start", { type: "session_start", reason: "startup" }, s1.ctx);
    await waitFor(() => counter.count >= 1);
    assert.equal(s1.widgets.length, 1, "widget registered on first session");

    // /new: pi tears down (reason "new") then starts a new session in-process.
    await api.fire("session_shutdown", { type: "session_shutdown", reason: "new" }, s1.ctx);

    const s2 = makeMockCtx();
    await api.fire("session_start", { type: "session_start", reason: "new" }, s2.ctx);

    // Bug 1 (pre-fix: stale activeWidget swallows the update, widget vanishes).
    assert.equal(s2.widgets.length, 1, "widget re-registered on the new session's TUI");

    // Bug 2 (pre-fix: shuttingDown flag blocks every refresh forever).
    const before = counter.count;
    await api.fire("agent_settled", { type: "agent_settled" }, s2.ctx);
    await waitFor(() => counter.count > before);
  });
});
