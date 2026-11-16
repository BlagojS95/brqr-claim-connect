// Agency staff shared types and helpers (Phase 7).

export interface StaffMember {
  userId: string;
  name: string;
  email: string | null;
}

/** Display name for an assigned_to id, or "Unassigned". */
export function staffName(
  staff: readonly StaffMember[],
  userId: string | null | undefined,
): string {
  if (!userId) return "Unassigned";
  return staff.find((s) => s.userId === userId)?.name ?? "Former staff member";
}
