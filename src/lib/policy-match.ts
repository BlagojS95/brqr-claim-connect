// Which policies can a reported loss go on? Used by the claim form to fill the
// policy dropdown and by submitClaim to check the chosen policy again.

export interface PolicyTerm {
  effective_date: string | null;
  expiration_date: string | null;
  line_of_business_id: string | null;
}

export interface LossToMatch {
  dateOfLoss: string | null;
  lineOfBusinessId: string | null;
}

/**
 * True when the policy's term includes the date of loss (both ends inclusive)
 * and its line of business is the claim's.
 *
 * Missing data counts as a match rather than hiding the policy: a policy with
 * no effective or expiration date is open on that side, a policy whose line
 * couldn't be resolved matches any line, and a loss without a date or line yet
 * isn't filtered on that part. Dates are "YYYY-MM-DD" text (timestamps are cut
 * to their date part), which compares in calendar order.
 */
export function policyCoversLoss(policy: PolicyTerm, loss: LossToMatch): boolean {
  if (
    loss.lineOfBusinessId &&
    policy.line_of_business_id &&
    policy.line_of_business_id !== loss.lineOfBusinessId
  ) {
    return false;
  }
  if (loss.dateOfLoss) {
    const day = loss.dateOfLoss.slice(0, 10);
    if (policy.effective_date && day < policy.effective_date.slice(0, 10)) return false;
    if (policy.expiration_date && day > policy.expiration_date.slice(0, 10)) return false;
  }
  return true;
}
