// Carrier CSV import (fix 53) on /admin/import. Every function checks the
// agency_admin role on the server (requireAgencyAdmin) and runs with the
// admin's own token, so the admin RLS policies on claims, claim_activity and
// carrier_import_mappings apply too. The apply step never trusts the browser's
// preview: it reloads the carrier's claims and redoes the matching itself.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput } from "@/lib/http-errors.server";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { fetchAll } from "@/lib/fetch-all";
import { CLAIM_ACTIVITY_KIND } from "@/lib/claim-activity";
import {
  CLAIM_EDITABLE_SELECT,
  claimUpdateActivityBody,
  type FieldChange,
} from "@/lib/claim-quick-edit";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import {
  CARRIER_IMPORT_CHUNK,
  CarrierMappingSchema,
  CarrierNameSchema,
  CarrierRowSchema,
  buildCarrierImportPreview,
  distinctCarriers,
  ilikeExact,
  type CarrierClaim,
  type CarrierMapping,
} from "@/lib/carrier-import";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<Database>;

export interface CarrierImportSetup {
  carriers: { name: string; claims: number }[];
  mappings: { carrier: string; mapping: CarrierMapping }[];
}

export const fetchCarrierImportSetup = createServerFn({ method: "GET" })
  .middleware([requireAgencyAdmin])
  .handler(async ({ context }): Promise<CarrierImportSetup> => {
    const [carrierRows, { data: mappings, error }] = await Promise.all([
      fetchAll<{ carrier: string | null }>((from, to) =>
        context.supabase
          .from("claims")
          .select("carrier")
          .not("carrier", "is", null)
          .order("id")
          .range(from, to),
      ),
      context.supabase.from("carrier_import_mappings").select("carrier, mapping").order("carrier"),
    ]);
    if (error) throw new Error(`Couldn't load saved mappings: ${error.message}`);
    return {
      carriers: distinctCarriers(carrierRows.map((r) => r.carrier)),
      mappings: (mappings ?? []).flatMap((m) => {
        const parsed = CarrierMappingSchema.safeParse(m.mapping);
        return parsed.success ? [{ carrier: m.carrier, mapping: parsed.data }] : [];
      }),
    };
  });

async function loadCarrierClaims(db: Db, carrier: string): Promise<CarrierClaim[]> {
  const rows = await fetchAll((from, to) =>
    db
      .from("claims")
      .select(`id, ${CLAIM_EDITABLE_SELECT}, clients(name, company_name)`)
      .ilike("carrier", ilikeExact(carrier))
      .order("id")
      .range(from, to),
  );
  return rows.map(({ clients, ...claim }) => ({
    ...claim,
    client_name: clients?.company_name || clients?.name || null,
  }));
}

/** The chosen carrier's claims, for the preview in the browser. */
export const fetchCarrierClaims = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(z.object({ carrier: CarrierNameSchema })))
  .handler(
    async ({ data, context }): Promise<CarrierClaim[]> =>
      loadCarrierClaims(context.supabase, data.carrier),
  );

/** Saves the column mapping for a carrier (one per carrier, case-insensitive). */
export const saveCarrierImportMapping = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(
    parseInput(z.object({ carrier: CarrierNameSchema, mapping: CarrierMappingSchema })),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing, error: findError } = await supabase
      .from("carrier_import_mappings")
      .select("id")
      .ilike("carrier", ilikeExact(data.carrier))
      .limit(1)
      .maybeSingle();
    if (findError) throw new Error(`Couldn't save the mapping: ${findError.message}`);
    const row = { mapping: data.mapping, updated_by: userId, updated_at: new Date().toISOString() };
    const { error } = existing
      ? await supabase.from("carrier_import_mappings").update(row).eq("id", existing.id)
      : await supabase.from("carrier_import_mappings").insert({ ...row, carrier: data.carrier });
    if (error) throw new Error(`Couldn't save the mapping: ${error.message}`);
    return { ok: true };
  });

const ApplySchema = z.object({
  carrier: CarrierNameSchema,
  rows: z.array(CarrierRowSchema).min(1).max(CARRIER_IMPORT_CHUNK),
});

/** Most status alert emails one import chunk sends. */
const MAX_IMPORT_ALERT_EMAILS = 20;

export interface CarrierImportApplyResult {
  updated: number;
  unchanged: number;
  unmatched: number;
  failed: { row: number; claimNumber: string; message: string }[];
}

/**
 * Applies one chunk of mapped rows: matched claims get the changed columns and
 * one 'claim_update' activity entry each ("Updated from <carrier> import: ...").
 * Status changes are also logged by the status trigger.
 */
export const applyCarrierImport = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(ApplySchema))
  .handler(async ({ data, context }): Promise<CarrierImportApplyResult> => {
    const { supabase, userId } = context;
    await loadDevVars();
    const claims = await loadCarrierClaims(supabase, data.carrier);
    const preview = buildCarrierImportPreview(data.rows, claims);

    const importedAt = new Date().toISOString();
    const result: CarrierImportApplyResult = {
      updated: 0,
      unchanged: preview.unchanged.length,
      unmatched: preview.unmatched.length,
      failed: [],
    };
    const statusAlerts: { claimId: string; changes: FieldChange[] }[] = [];
    const activity: Database["public"]["Tables"]["claim_activity"]["Insert"][] = [];
    for (const match of preview.changed) {
      const { error } = await supabase
        .from("claims")
        .update({ ...match.update, carrier_updated_at: importedAt })
        .eq("id", match.claimId);
      if (error) {
        result.failed.push({
          row: match.row,
          claimNumber: match.claimNumber,
          message: error.message,
        });
        continue;
      }
      result.updated++;
      if (match.changes.some((c) => c.field === "status")) {
        statusAlerts.push({ claimId: match.claimId, changes: match.changes });
      }
      const body = claimUpdateActivityBody(match.changes, `Updated from ${data.carrier} import: `);
      if (body) {
        activity.push({
          claim_id: match.claimId,
          actor_id: userId,
          kind: CLAIM_ACTIVITY_KIND.claim_update,
          body,
        });
      }
    }
    if (activity.length) {
      const { error } = await supabase.from("claim_activity").insert(activity);
      if (error) throw new Error(`Claims updated, but couldn't log the changes: ${error.message}`);
    }
    // Status change alerts go out after everything is saved; capped per chunk so
    // a big import can't run into the email rate limit.
    if (statusAlerts.length) {
      const { alertStatusChange } = await import("@/lib/claim-status-alerts.server");
      const budget = { remaining: MAX_IMPORT_ALERT_EMAILS };
      for (const alert of statusAlerts) {
        if (budget.remaining <= 0) break;
        await alertStatusChange(alert.claimId, alert.changes, userId, budget);
      }
    }
    return result;
  });
