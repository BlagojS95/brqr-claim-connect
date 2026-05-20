import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PayloadSchema = z.object({
  claim_id: z.string(),
  client_id: z.string(),
});

export const notifyNewClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PayloadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: claim } = await supabase
      .from("claims")
      .select("*, policies(policy_number), clients(name, company_name)")
      .eq("id", data.claim_id)
      .maybeSingle();
    const { data: docs } = await supabase
      .from("documents")
      .select("file_name, file_url")
      .eq("claim_id", data.claim_id);

    const payload = {
      claim_id: data.claim_id,
      client_id: data.client_id,
      client_name: (claim?.clients as { name?: string; company_name?: string } | null)?.company_name ||
        (claim?.clients as { name?: string } | null)?.name || "",
      policy_number: (claim?.policies as { policy_number?: string } | null)?.policy_number ?? "",
      claim_type: claim?.claim_type ?? "",
      date_of_loss: claim?.date_of_loss ?? "",
      description: claim?.description ?? "",
      carrier: claim?.carrier ?? "",
      documents: docs ?? [],
    };

    try {
      const res = await fetch("https://n8n.brqr.com/webhook/new-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { ok: res.ok, status: res.status };
    } catch (err) {
      console.error("webhook failed", err);
      return { ok: false, error: "Webhook delivery failed" };
    }
  });
