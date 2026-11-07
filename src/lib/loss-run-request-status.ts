// The statuses of a loss_run_requests row. The column is plain text with
// DEFAULT 'Pending' (supabase/migrations/20260520171003_2042d7c2-...sql), so
// these values are capitalised and must match the stored text exactly. This is
// a separate set from the claim statuses in claim-status.ts.

export const LOSS_RUN_REQUEST_STATUSES = ["Pending", "Fulfilled"] as const;

export type LossRunRequestStatus = (typeof LOSS_RUN_REQUEST_STATUSES)[number];

export const LOSS_RUN_REQUEST_STATUS = {
  pending: "Pending",
  fulfilled: "Fulfilled",
} as const satisfies Record<string, LossRunRequestStatus>;

export function isLossRunRequestStatus(value: unknown): value is LossRunRequestStatus {
  return (
    typeof value === "string" && (LOSS_RUN_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}
