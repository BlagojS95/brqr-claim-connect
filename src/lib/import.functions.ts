import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { runImport, type ImportResult } from "@/lib/import-core";

export type { ImportResult };

const ImportSchema = z.object({
  kind: z.enum(["clients", "policies", "claims"]),
  // Rows already mapped to field names by mapRows() in import-mapping.ts.
  rows: z.array(z.record(z.string(), z.string())).max(1000),
  dryRun: z.boolean().default(false),
});

// Admin-only, and the import runs with the admin's own token, so the
// "admin manages ..." RLS policies are what authorize it.
export const importRows = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator((input) => ImportSchema.parse(input))
  .handler(async ({ data, context }): Promise<ImportResult> => {
    return runImport(context.supabase, data);
  });
