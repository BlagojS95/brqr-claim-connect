// Data freshness (fix 62): how recently the carrier's numbers were updated.
// carrier_updated_at is set by quick edit and the carrier import
// (claim-quick-edit.functions.ts, carrier-import.functions.ts); the claims
// passed in are only those the caller can see, so a client never learns the
// date of someone else's update.

import { formatDateTime } from "@/lib/claim-quick-edit";

/** The newest carrier_updated_at among the claims, or null when none has one. */
export function latestCarrierUpdate(
  claims: readonly { carrier_updated_at: string | null }[],
): string | null {
  let latest: string | null = null;
  let latestTime = -Infinity;
  for (const c of claims) {
    if (!c.carrier_updated_at) continue;
    const time = Date.parse(c.carrier_updated_at);
    if (Number.isNaN(time) || time <= latestTime) continue;
    latest = c.carrier_updated_at;
    latestTime = time;
  }
  return latest;
}

/** "Last updated from carrier 11/16/2026, 3:05 PM ET" or "No carrier updates yet". */
export function carrierUpdatedText(iso: string | null | undefined): string {
  return iso
    ? `Last updated from carrier ${formatDateTime(iso)}`
    : "No carrier updates recorded yet";
}
