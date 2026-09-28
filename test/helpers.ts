/**
 * Shared test doubles for the session-lifecycle regression tests.
 *
 * Each scenario runs in its own file (own process) because the extension
 * keeps module-level state that must not leak between scenarios.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Cache dir is derived from $HOME at import time; isolate before importing.
export const fakeHome = mkdtempSync(join(tmpdir(), "pi-ark-usage-test-"));
process.env.HOME = fakeHome;
process.env.VOLC_ACCESSKEY = "test-ak";
process.env.VOLC_SECRETKEY = "test-sk";

export function makeMockPi() {
  const handlers = new Map();
  const commands = new Map();
  return {
    handlers,
    commands,
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
    registerCommand(name, cmd) {
      commands.set(name, cmd.handler);
    },
    async fire(event, payload, ctx) {
      for (const h of handlers.get(event) ?? []) await h(payload, ctx);
    },
  };
}

export const minimalTheme = new Proxy(
  {},
  { get: (_t, prop) => (text) => `[${String(prop)}]${text}` },
);

export function makeMockCtx() {
  const widgets = [];
  const notifications = [];
  const ctx = {
    model: { provider: "coding-plan", id: "test-model" },
    isIdle: () => true,
    ui: {
      setWidget(_key, factory) {
        // pi invokes the factory immediately (see setExtensionWidget).
        widgets.push(factory({ requestRender() {} }, minimalTheme));
      },
      notify(msg) {
        notifications.push(msg);
      },
    },
  };
  return { ctx, widgets, notifications };
}

/** Stub the Ark OpenAPI endpoint with a valid GetCodingPlanUsage payload. */
export function stubFetch(counter) {
  const body = JSON.stringify({
    ResponseMetadata: { RequestId: "test" },
    Result: {
      Status: "ok",
      UpdateTimestamp: 1_758_000_000,
      QuotaUsage: [
        { Level: "session", Percent: 10.5, ResetTimestamp: 1_758_100_000 },
        { Level: "weekly", Percent: 20.25, ResetTimestamp: 1_758_200_000 },
        { Level: "monthly", Percent: 30.75, ResetTimestamp: 1_758_300_000 },
      ],
    },
  });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    counter.count++;
    return new Response(body, { status: 200 });
  });
  return () => {
    globalThis.fetch = original;
  };
}

export async function waitFor(cond, ms = 2000) {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}
