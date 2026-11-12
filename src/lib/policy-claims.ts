// The claims against one policy and their totals (fix 42), for the policy
// detail page. The server computes the totals (fetchPolicyDetail) with the
// same claim-metrics functions every other page uses.

import {
  incurredAmount,
  isOpen,
  paidAmount,
  reserveAmount,
  type ClaimAmounts,
  type ClaimStatusFields,
} from "@/lib/claim-metrics";

export interface PolicyKey {
  id: string;
  client_id: string;
  policy_number: string;
}

export interface ClaimPolicyFields {
  client_id: string;
  policy_id: string | null;
  policy_number: string | null;
}

// Policy numbers compare trimmed and ignoring case and inner spaces:
// "gl 1001" on a claim is policy "GL1001".
export function policyNumberKey(value: string | null | undefined): string {
  return value?.replace(/\s+/g, "").toLowerCase() ?? "";
}

/**
 * True when the claim is against the policy: the claim was filed on it
 * (policy_id), or it carries the policy's number for the same client.
 */
export function isClaimOnPolicy(claim: ClaimPolicyFields, policy: PolicyKey): boolean {
  if (claim.client_id !== policy.client_id) return false;
  if (claim.policy_id) return claim.policy_id === policy.id;
  const number = policyNumberKey(claim.policy_number);
  return number !== "" && number === policyNumberKey(policy.policy_number);
}

export interface PolicyTotals {
  claims: number;
  open: number;
  paid: number;
  reserve: number;
  incurred: number;
}

export function policyTotals(claims: readonly (ClaimAmounts & ClaimStatusFields)[]): PolicyTotals {
  return claims.reduce<PolicyTotals>(
    (t, c) => ({
      claims: t.claims + 1,
      open: t.open + (isOpen(c) ? 1 : 0),
      paid: t.paid + paidAmount(c),
      reserve: t.reserve + reserveAmount(c),
      incurred: t.incurred + incurredAmount(c),
    }),
    { claims: 0, open: 0, paid: 0, reserve: 0, incurred: 0 },
  );
}
