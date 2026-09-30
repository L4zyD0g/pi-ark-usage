/** Regression: after `/resume` the status must be re-published and refresh must resume. */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  makeMockPi,
  makeMockCtx,
  stubFetch,
  waitFor,
} from "./helpers.ts";

const { default: createExtension } = await import("../extensions/index.ts");

describe("/resume session switch", () => {
  let restoreFetch;
  let counter;

  beforeEach(() => {
    counter = { count: 0 };
    restoreFetch = stubFetch(counter);
  });
  afterEach(() => restoreFetch());

  it("re-publishes status and keeps fetching after /resume", async () => {
    const api = makeMockPi();
    createExtension(api);

    const s1 = makeMockCtx();
    await api.fire("session_start", { type: "session_start", reason: "startup" }, s1.ctx);
    await waitFor(() => counter.count >= 1);

    await api.fire("session_shutdown", { type: "session_shutdown", reason: "resume" }, s1.ctx);

    const s2 = makeMockCtx();
    await api.fire("session_start", { type: "session_start", reason: "resume" }, s2.ctx);
    await waitFor(() => (s2.statuses.get("ark-usage") ?? "").includes("|"),
      "status re-published on the resumed session");

    const before = counter.count;
    await api.fire("agent_settled", { type: "agent_settled" }, s2.ctx);
    await waitFor(() => counter.count > before);
  });
});
