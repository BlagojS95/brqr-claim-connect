// Read-only share links for reports (fixes 44 and 46). Shared by the pages and
// the server functions in shared-reports.functions.ts; no Supabase imports.

import { z } from "zod";
import { CLAIM_STATUSES } from "@/lib/claim-status";

export const SHARED_REPORT_KIND = {
  lossSummary: "loss_summary",
  executiveReport: "executive_report",
} as const;

export type SharedReportKind = (typeof SHARED_REPORT_KIND)[keyof typeof SHARED_REPORT_KIND];

export const SHARE_DAYS_DEFAULT = 14;
export const SHARE_DAYS_MAX = 90;
export const SHARE_DAY_CHOICES = [7, 14, 30, 90] as const;

/** 32 random bytes as base64url: 43 characters, no padding. */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const ShareDaysSchema = z.number().int().min(1).max(SHARE_DAYS_MAX);

const year = z.number().int().min(0).max(2100);
const text = z.string().trim().min(1).max(200);

export const LossSummaryFiltersSchema = z.object({
  year: year.optional(),
  line: text.optional(),
  carrier: text.optional(),
});

/** Only the fields the Loss Summary shows: no claimant names or descriptions. */
export const LossSummarySnapshotClaimSchema = z.object({
  id: z.string(),
  claim_number: z.string().nullable(),
  status: z.enum(CLAIM_STATUSES),
  line_of_business: z.string(),
  carrier: z.string().nullable(),
  date_of_loss: z.string().nullable(),
  paid_amount: z.number().nullable(),
  reserve_amount: z.number().nullable(),
});

export const LossSummarySnapshotSchema = z.object({
  version: z.literal(1),
  /** "YYYY-MM-DD": the day the link was made. */
  valuedAsOf: z.string(),
  clientName: z.string(),
  filters: LossSummaryFiltersSchema,
  claims: z.array(LossSummarySnapshotClaimSchema),
});

export type LossSummarySnapshot = z.infer<typeof LossSummarySnapshotSchema>;

/** A share link as its managers see it; never the token or the report itself. */
export interface SharedReportSummary {
  id: string;
  kind: SharedReportKind;
  client_id: string;
  title: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export type ShareLinkState = "active" | "expired" | "revoked";

export function shareLinkState(
  link: Pick<SharedReportSummary, "expires_at" | "revoked_at">,
  now: Date = new Date(),
): ShareLinkState {
  if (link.revoked_at) return "revoked";
  return Date.parse(link.expires_at) <= now.getTime() ? "expired" : "active";
}

/** The address a token opens, on whatever host the app is served from. */
export function sharePath(token: string): string {
  return `/shared/${token}`;
}
