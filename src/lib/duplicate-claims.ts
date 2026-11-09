// Duplicate warning on the report form (fix 38). Before a claim is saved, the
// caller's existing claims are checked for one that looks like the same loss:
// same date of loss, same line of business, and the same person (claimant or
// employee) or the same vehicle. Kept free of Supabase imports so it can be
// unit tested; the server functions load the candidates with the caller's
// token, so RLS limits a client to their own claims.

import type { ClaimStatus } from "@/lib/claim-status";

/** What the new report says about the loss. */
export interface DuplicateProbe {
  dateOfLoss: string;
  lineOfBusinessId: string;
  claimantName?: string | null;
  employeeName?: string | null;
  vehiclesInvolved?: string | null;
  /** The id the new claim will get; never reported as its own duplicate. */
  claimId?: string | null;
}

/** An existing claim row, as loaded for the check. */
export interface DuplicateCandidate {
  id: string;
  claim_number: string | null;
  claim_type: string;
  status: ClaimStatus;
  date_of_loss: string | null;
  line_of_business_id: string | null;
  claimant_name: string | null;
  employee_name: string | null;
  vehicles_involved: string | null;
}

/** What the form shows for each possible duplicate. */
export interface DuplicateMatch {
  id: string;
  claim_number: string | null;
  claim_type: string;
  status: ClaimStatus;
  date_of_loss: string | null;
}

/** The columns the server functions select for DuplicateCandidate. */
export const DUPLICATE_CANDIDATE_COLUMNS =
  "id, claim_number, claim_type, status, date_of_loss, line_of_business_id, claimant_name, employee_name, vehicles_involved";

/**
 * Case- and space-insensitive form of a name or vehicle description, so
 * "John  Smith" and "john smith" compare equal. Blank text gives null and
 * never matches anything.
 */
export function normalizeForMatch(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, "").toLowerCase();
  return text ? text : null;
}

function present(values: (string | null | undefined)[]): Set<string> {
  const set = new Set<string>();
  for (const value of values) {
    const normalized = normalizeForMatch(value);
    if (normalized) set.add(normalized);
  }
  return set;
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

/**
 * The existing claims that look like the same loss as the probe. A claimant
 * on one report and the employee on another count as the same person, since
 * people fill in whichever field they see.
 */
export function findDuplicateClaims(
  probe: DuplicateProbe,
  candidates: readonly DuplicateCandidate[],
): DuplicateMatch[] {
  const people = present([probe.claimantName, probe.employeeName]);
  const vehicle = normalizeForMatch(probe.vehiclesInvolved);
  if (!people.size && !vehicle) return [];

  return candidates
    .filter((c) => {
      if (probe.claimId && c.id === probe.claimId) return false;
      if (c.date_of_loss !== probe.dateOfLoss) return false;
      if (c.line_of_business_id !== probe.lineOfBusinessId) return false;
      const samePerson = overlaps(people, present([c.claimant_name, c.employee_name]));
      const sameVehicle = vehicle !== null && normalizeForMatch(c.vehicles_involved) === vehicle;
      return samePerson || sameVehicle;
    })
    .map(({ id, claim_number, claim_type, status, date_of_loss }) => ({
      id,
      claim_number,
      claim_type,
      status,
      date_of_loss,
    }));
}
