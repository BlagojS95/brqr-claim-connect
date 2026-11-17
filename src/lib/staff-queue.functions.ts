import { createServerFn } from "@tanstack/react-start";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { fetchAll } from "@/lib/fetch-all";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";
import { OUTBOX_STATUS } from "@/lib/claim-submission";
import type { AttentionContactEmail } from "@/lib/attention-queue";
import {
  buildStaffQueue,
  type StaffQueueClaim,
  type StaffQueueItem,
  type StaffQueueOutboxRow,
} from "@/lib/staff-queue";
import type { WaitingOn } from "@/lib/waiting-on";
import { loadResponseTargets } from "@/lib/response-targets.server";
import type { ResponseTargets } from "@/lib/response-targets";

interface ClaimRow {
  id: string;
  claim_number: string | null;
  claim_type: string;
  client_id: string;
  status: ClaimStatus;
  waiting_on: WaitingOn | null;
  assigned_to: string | null;
  last_activity_at: string | null;
  created_at: string;
  submitted_to_carrier_at: string | null;
  first_carrier_contact_at: string | null;
  clients: { name: string | null; company_name: string | null } | null;
}

interface EmailRow {
  claim_id: string;
  claim_contact_id: string;
  sent_at: string;
  replied_at: string | null;
  claim_contacts: { row_key: string } | null;
}

export interface StaffQueueResult {
  items: StaffQueueItem[];
  /** The response targets the "Past target" flags used (fix 56). */
  targets: ResponseTargets;
}

// Staff work queue (fix 52). Agency admins only: the role is checked here on
// the server, and every query still runs with the caller's own token (like
// attention.functions.ts), so RLS applies too. No service-role client.
export const fetchStaffQueue = createServerFn({ method: "GET" })
  .middleware([requireAgencyAdmin])
  .handler(async ({ context }): Promise<StaffQueueResult> => {
    const { supabase } = context;
    const [claimRows, emailRows, outbox, targets] = await Promise.all([
      fetchAll<ClaimRow>((from, to) =>
        supabase
          .from("claims")
          .select(
            "id, claim_number, claim_type, client_id, status, waiting_on, assigned_to, last_activity_at, created_at, submitted_to_carrier_at, first_carrier_contact_at, clients(name, company_name)",
          )
          .neq("status", CLAIM_STATUS.closed)
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
      fetchAll<StaffQueueOutboxRow>((from, to) =>
        supabase
          .from("notification_outbox")
          .select("id, claim_id, kind, status, created_at")
          .eq("status", OUTBOX_STATUS.failed)
          .order("id")
          .range(from, to),
      ),
      loadResponseTargets(supabase),
    ]);

    const claims: StaffQueueClaim[] = claimRows.map(({ clients, ...c }) => ({
      ...c,
      client_name: clients?.company_name || clients?.name || "",
    }));
    const contactEmails: AttentionContactEmail[] = emailRows.map((e) => ({
      claim_id: e.claim_id,
      claim_contact_id: e.claim_contact_id,
      sent_at: e.sent_at,
      replied_at: e.replied_at,
      row_key: e.claim_contacts?.row_key ?? null,
    }));

    return {
      items: buildStaffQueue({ claims, contactEmails, outbox }, new Date(), targets),
      targets,
    };
  });
