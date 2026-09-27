/**
 * Compatibility layer: `lib/arkcli.js` used to wrap the `arkcli` binary; the
 * extension now talks to the Ark OpenAPI directly with AK/SK (see `aksk.ts`).
 * All exports keep their names so callers don't change.
 */

import type { ArkPlanOutput } from "./types.js";
import {
  fetchPlan as fetchPlanAksk,
  checkCredentialsAvailable,
} from "./aksk.js";
import type { FetchPlanOptions } from "./aksk.js";
export type { ArkPlanOutput, FetchPlanOptions } from "./aksk.js";

/** @deprecated legacy probe kept only for interface compatibility; always true. */
export async function checkArkcliAvailable(): Promise<boolean> {
  return checkCredentialsAvailable();
}

/**
 * Fetch Coding Plan usage.
 * `product`/`seat` options are accepted for interface compatibility but
 * ignored: the AK/SK OpenAPI reports the plan bound to the credential's
 * account and has no product/seat filter.
 */
export function fetchPlan(options: FetchPlanOptions = {}): Promise<ArkPlanOutput> {
  return fetchPlanAksk(options);
}
