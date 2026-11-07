// Shared rules for the per-claim contacts table (claim-contacts-table.tsx and
// ensureClaimContacts in claim-contacts.functions.ts).

// Used until the agency_settings row exists or when it can't be read.
export const DEFAULT_BROKER_CLAIMS_EMAIL = "claims@brqr.com";

// Rows shown, in order. Old claims also have an "other_2" row in the database;
// it is no longer shown.
export const CONTACT_ROW_KEYS = [
  "broker_claims_contact",
  "adjuster",
  "attorney",
  "other_1",
] as const;

export const CONTACT_ROW_LABELS: Record<string, string> = {
  broker_claims_contact: "Broker Claims Contact",
  adjuster: "Adjuster",
  attorney: "Attorney",
  other_1: "Other",
};

export interface ClaimAdjusterFields {
  adjuster_name: string | null;
  adjuster_email: string | null;
  adjuster_phone: string | null;
}

interface ContactRowFields {
  row_key: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * Orders the contact rows and fills in values that come from elsewhere:
 * - Adjuster: any field left empty on the row is taken from the claim's
 *   adjuster fields, so it shows what the claim (CSV import) says until
 *   someone types over it.
 * - Broker Claims Contact: the email is always the agency's shared claims
 *   inbox from agency_settings, never a per-claim value.
 */
export function applyContactDefaults<T extends ContactRowFields>(
  rows: T[],
  claim: ClaimAdjusterFields,
  brokerClaimsEmail: string | null | undefined,
): T[] {
  return CONTACT_ROW_KEYS.flatMap((key) => {
    const row = rows.find((r) => r.row_key === key);
    if (!row) return [];
    if (key === "adjuster") {
      return [
        {
          ...row,
          contact_person: row.contact_person || claim.adjuster_name || null,
          email: row.email || claim.adjuster_email || null,
          phone: row.phone || claim.adjuster_phone || null,
        },
      ];
    }
    if (key === "broker_claims_contact") {
      return [{ ...row, email: brokerClaimsEmail?.trim() || DEFAULT_BROKER_CLAIMS_EMAIL }];
    }
    return [row];
  });
}
