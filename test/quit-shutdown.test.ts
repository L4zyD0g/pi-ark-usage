/** Guard: after `quit` fetching must stop (and a later session_start revives it defensively). */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  makeMockPi,
  makeMockCtx,
  stubFetch,
  waitFor,
} from "./helpers.ts";

const { default: createExtension } = await import("../extensions/index.ts");

describe("quit shutdown", () => {
  let restoreFetch;
  let counter;

  beforeEach(() => {
    counter = { count: 0 };
    restoreFetch = stubFetch(counter);
  });
  afterEach(() => restoreFetch());

  it("stops fetching after quit; revives on a later session_start", async () => {
    const api = makeMockPi();
    createExtension(api);

    const s1 = makeMockCtx();
    await api.fire("session_start", { type: "session_start", reason: "startup" }, s1.ctx);
    await waitFor(() => counter.count >= 1);

    await api.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, s1.ctx);

    const before = counter.count;
    await api.fire("agent_settled", { type: "agent_settled" }, s1.ctx);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(counter.count, before, "no fetch attempts after quit");

    // Defensive: a session_start in the same process after quit revives the extension.
    const s2 = makeMockCtx();
    await api.fire("session_start", { type: "session_start", reason: "resume" }, s2.ctx);
    await waitFor(() => counter.count > before);
  });
});
