import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LOSS_RUN_REQUEST_STATUS,
  LOSS_RUN_REQUEST_STATUSES,
  isLossRunRequestStatus,
} from "@/lib/loss-run-request-status";

describe("loss run request statuses", () => {
  it("lists every named status", () => {
    expect(Object.values(LOSS_RUN_REQUEST_STATUS)).toEqual([...LOSS_RUN_REQUEST_STATUSES]);
  });

  it("uses the column default as the pending value", () => {
    const sql = readFileSync(
      "supabase/migrations/20260520171003_2042d7c2-f6f4-4fe4-8d61-6bae3f57e6e8.sql",
      "utf8",
    );
    expect(sql).toContain(`status TEXT NOT NULL DEFAULT '${LOSS_RUN_REQUEST_STATUS.pending}'`);
  });

  it("recognises only the stored values", () => {
    expect(isLossRunRequestStatus("Pending")).toBe(true);
    expect(isLossRunRequestStatus("Fulfilled")).toBe(true);
    expect(isLossRunRequestStatus("pending")).toBe(false);
    expect(isLossRunRequestStatus(null)).toBe(false);
  });
});
