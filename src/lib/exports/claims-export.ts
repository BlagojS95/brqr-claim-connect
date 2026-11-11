// The claims list export (fix 34): exactly the filtered and sorted list the
// user is looking at, every page of it, as a table for CSV or Excel.

import {
  incurredAmount,
  paidAmount,
  recoveryAmount,
  reserveAmount,
  totalIncurred,
  totalPaid,
} from "@/lib/claim-metrics";
import { CLAIM_STATUS_LABELS } from "@/lib/claim-status";
import {
  DEFAULT_CLAIM_SORT,
  defaultSortDir,
  filterClaims,
  sortClaims,
  type ClaimListItem,
  type ClaimsSearch,
} from "@/lib/claims-list";
import { formatDate } from "@/lib/dates";
import { claimLocationLabel, type AgencyClaim } from "@/lib/overview.types";
import { WAITING_ON_LABELS } from "@/lib/waiting-on";
import type { ExportCell, ExportColumn, ExportTable } from "@/lib/exports/table";

export { toCsv } from "@/lib/exports/table";

export type ExportClaim = Pick<
  AgencyClaim,
  | "claim_number"
  | "status"
  | "waiting_on"
  | "claim_type"
  | "line_of_business"
  | "cause_of_loss"
  | "loss_location"
  | "location_name"
  | "date_of_loss"
  | "date_reported"
  | "closed_date"
  | "carrier"
  | "claimant_name"
  | "adjuster_name"
  | "paid_amount"
  | "reserve_amount"
  | "recovery_amount"
  | "client_name"
>;

interface ClaimColumn extends ExportColumn {
  value: (claim: ExportClaim) => ExportCell;
}

const text = (value: string | null | undefined): ExportCell => value?.trim() || null;
const date = (value: string | null): ExportCell => formatDate(value, "") || null;

const CLAIM_COLUMNS: ClaimColumn[] = [
  { label: "Claim #", kind: "text", value: (c) => text(c.claim_number) },
  { label: "Status", kind: "text", value: (c) => CLAIM_STATUS_LABELS[c.status] },
  {
    label: "Waiting on",
    kind: "text",
    value: (c) => (c.waiting_on ? WAITING_ON_LABELS[c.waiting_on] : null),
  },
  { label: "Type", kind: "text", value: (c) => text(c.claim_type) },
  { label: "Line of business", kind: "text", value: (c) => text(c.line_of_business) },
  { label: "Cause of loss", kind: "text", value: (c) => text(c.cause_of_loss) },
  // The client's site (fix 32), or the loss location text when none is set.
  { label: "Location", kind: "text", value: (c) => text(claimLocationLabel(c)) },
  { label: "Date of loss", kind: "date", value: (c) => date(c.date_of_loss) },
  { label: "Reported", kind: "date", value: (c) => date(c.date_reported) },
  { label: "Closed", kind: "date", value: (c) => date(c.closed_date) },
  { label: "Carrier", kind: "text", value: (c) => text(c.carrier) },
  { label: "Claimant", kind: "text", value: (c) => text(c.claimant_name) },
  { label: "Adjuster", kind: "text", value: (c) => text(c.adjuster_name) },
  { label: "Paid", kind: "money", value: (c) => paidAmount(c) },
  { label: "Reserve", kind: "money", value: (c) => reserveAmount(c) },
  { label: "Recoveries", kind: "money", value: (c) => recoveryAmount(c) },
  { label: "Incurred", kind: "money", value: (c) => incurredAmount(c) },
];

const CLIENT_COLUMN: ClaimColumn = {
  label: "Client",
  kind: "text",
  value: (c) => text(c.client_name),
};

/** The rows the list shows, in its order, ignoring the page: what an export contains. */
export function claimsToExport<T extends ClaimListItem>(claims: T[], search: ClaimsSearch): T[] {
  const sort = search.sort ?? DEFAULT_CLAIM_SORT;
  const dir = search.dir ?? defaultSortDir(sort);
  return sortClaims(filterClaims(claims, search), sort, dir);
}

/**
 * The export table. The client column is only for agency admins, who see more
 * than one client; a client's own export would just repeat their name.
 */
export function buildClaimsExport(
  claims: ExportClaim[],
  { includeClient }: { includeClient: boolean },
): ExportTable {
  const columns = includeClient ? [...CLAIM_COLUMNS, CLIENT_COLUMN] : CLAIM_COLUMNS;
  const rows = claims.map((claim) => columns.map((col) => col.value(claim)));
  const sums: Record<string, number> = {
    Paid: totalPaid(claims),
    Reserve: claims.reduce((sum, c) => sum + reserveAmount(c), 0),
    Recoveries: claims.reduce((sum, c) => sum + recoveryAmount(c), 0),
    Incurred: totalIncurred(claims),
  };
  const totals = columns.map((col, i): ExportCell => {
    if (i === 0) return `Total (${claims.length} ${claims.length === 1 ? "claim" : "claims"})`;
    return col.label in sums ? sums[col.label] : null;
  });
  return { columns: columns.map(({ label, kind }) => ({ label, kind })), rows, totals };
}
