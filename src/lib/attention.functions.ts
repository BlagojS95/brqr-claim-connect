import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchAll } from "@/lib/fetch-all";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";
import {
  buildAttentionQueue,
  type AttentionClaim,
  type AttentionContactEmail,
  type AttentionDocumentRequest,
  type AttentionItem,
} from "@/lib/attention-queue";

interface ClaimRow {
  id: string;
  claim_number: string | null;
  claim_type: string;
  status: ClaimStatus;
  last_activity_at: string | null;
  created_at: string;
  clients: { name: string | null; company_name: string | null } | null;
}

interface EmailRow {
  claim_id: string;
  claim_contact_id: string;
  sent_at: string;
  replied_at: string | null;
  claim_contacts: { row_key: string } | null;
}

// "Needs your attention" on Home (fix 29). Like fetchAgencyOverview, every
// query runs with the caller's own token, so RLS decides what is in the queue:
// an agency_admin gets every client's claims, a client only their own. No role
// checks and no service-role client here on purpose.
export const fetchAttentionQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ items: AttentionItem[] }> => {
    const { supabase } = context;
    const [claimRows, requestRows, emailRows] = await Promise.all([
      fetchAll<ClaimRow>((from, to) =>
        supabase
          .from("claims")
          .select(
            "id, claim_number, claim_type, status, last_activity_at, created_at, clients(name, company_name)",
          )
          .neq("status", CLAIM_STATUS.closed)
          .order("id")
          .range(from, to),
      ),
      fetchAll<AttentionDocumentRequest>((from, to) =>
        supabase
          .from("claim_document_requests")
          .select("id, claim_id, name, requested_at, fulfilled_at")
          .is("fulfilled_at", null)
          .order("id")
          .range(from, to),
      ),
      fetchAll<EmailRow>((from, to) =>
        supabase
          .from("claim_contact_emails")
          .select("claim_id, claim_contact_id, sent_at, replied_at, claim_contacts(row_key)")
          .order("id")
          .range(from, to),
      ),
    ]);

    const claims: AttentionClaim[] = claimRows.map((c) => ({
      id: c.id,
      claim_number: c.claim_number,
      claim_type: c.claim_type,
      client_name: c.clients?.company_name || c.clients?.name || "",
      status: c.status,
      last_activity_at: c.last_activity_at,
      created_at: c.created_at,
    }));
    const contactEmails: AttentionContactEmail[] = emailRows.map((e) => ({
      claim_id: e.claim_id,
      claim_contact_id: e.claim_contact_id,
      sent_at: e.sent_at,
      replied_at: e.replied_at,
      row_key: e.claim_contacts?.row_key ?? null,
    }));

    return {
      items: buildAttentionQueue(
        { claims, documentRequests: requestRows, contactEmails },
        new Date(),
      ),
    };
  });
