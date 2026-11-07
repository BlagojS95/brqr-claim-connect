// A policy's status is not stored: fetchAgencyOverview works it out from the
// policy dates (computePolicyStatus in overview.functions.ts). Pages compare
// against these constants, never raw strings. The values are also the labels.

export const POLICY_STATUSES = ["Active", "Non Active"] as const;

export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const POLICY_STATUS = {
  active: "Active",
  inactive: "Non Active",
} as const satisfies Record<string, PolicyStatus>;
