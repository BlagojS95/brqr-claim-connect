import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { DEFAULT_RESPONSE_TARGETS, type ResponseTargets } from "@/lib/response-targets";

/**
 * The two response targets (fix 56) from agency_settings id=1, read with the
 * caller's client, or the defaults if the row can't be read.
 */
export async function loadResponseTargets(
  supabase: SupabaseClient<Database>,
): Promise<ResponseTargets> {
  const { data } = await supabase
    .from("agency_settings")
    .select("submit_target_business_days, first_contact_target_business_days")
    .eq("id", 1)
    .maybeSingle();
  return {
    submitTargetDays:
      data?.submit_target_business_days ?? DEFAULT_RESPONSE_TARGETS.submitTargetDays,
    firstContactTargetDays:
      data?.first_contact_target_business_days ?? DEFAULT_RESPONSE_TARGETS.firstContactTargetDays,
  };
}
