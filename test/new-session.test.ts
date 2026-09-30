/** Regression: after `/new` the status must be re-published and refresh must resume. */
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

  it("re-publishes status and keeps fetching after /new", async () => {
    const api = makeMockPi();
    createExtension(api);

    const s1 = makeMockCtx();
    await api.fire("session_start", { type: "session_start", reason: "startup" }, s1.ctx);
    await waitFor(() => (s1.statuses.get("ark-usage") ?? "").includes("|"));

    // /new: pi tears down (reason "new") then starts a new session in-process.
    await api.fire("session_shutdown", { type: "session_shutdown", reason: "new" }, s1.ctx);

    const s2 = makeMockCtx();
    await api.fire("session_start", { type: "session_start", reason: "new" }, s2.ctx);

    // Snapshots survive the in-process switch, so the new session's status
    // must be published immediately (pre-fix: stale widget state swallowed it).
    await waitFor(() => (s2.statuses.get("ark-usage") ?? "").includes("|"));

    // Bug 2 (pre-fix: shuttingDown flag blocks every refresh forever).
    const before = counter.count;
    await api.fire("agent_settled", { type: "agent_settled" }, s2.ctx);
    await waitFor(() => counter.count > before);
  });
});
