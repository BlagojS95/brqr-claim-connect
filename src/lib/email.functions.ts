import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { escapeHtml, FONT_STACK, NAVY, sendViaResend } from "@/lib/claim-notifications.server";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import { normalizeRequestLines, sortRequestYears } from "@/lib/loss-run-request";

// The new-claim email is sent through the notification outbox
// (claim-submission.functions.ts), not from here.

function buildLossRunRequestHtml(opts: {
  namedInsured: string;
  years: number[];
  lines: string[];
  notes: string;
}): string {
  const rows: [string, string][] = [
    ["Named Insured", opts.namedInsured],
    ["Years", opts.years.join(", ") || "—"],
    ["Lines of Business", opts.lines.join(", ") || "—"],
    ["Notes", opts.notes || "—"],
  ];
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background-color:#FAFCFE;font-family:${FONT_STACK};">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;background-color:#FFFFFF;border-radius:8px;border:1px solid #E0E5EB;">
      <tr>
        <td style="padding:32px;">
          <h1 style="color:${NAVY};font-size:20px;margin:0 0 16px;">Loss Run Request</h1>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${rows
              .map(
                ([label, value]) =>
                  `<tr><td style="padding:6px 0;color:#5C646F;font-size:13px;width:160px;vertical-align:top;">${label}</td><td style="padding:6px 0;color:#0A1628;font-size:14px;white-space:pre-wrap;">${escapeHtml(value)}</td></tr>`,
              )
              .join("")}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export const sendLossRunRequestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(z.object({ requestId: z.string() })))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const { data: request } = await context.supabase
      .from("loss_run_requests")
      .select("*")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!request) throw new Error("Loss run request not found");

    // No FK from loss_run_requests to clients, so this can't be an embedded select.
    const { data: clientRow } = await context.supabase
      .from("clients")
      .select("name, company_name")
      .eq("id", request.client_id)
      .maybeSingle();
    const namedInsured = clientRow?.company_name || clientRow?.name || "Unknown Insured";
    // Oldest year first and lookup-table line names, also for requests saved before that.
    const years = sortRequestYears(request.years);
    const lines = normalizeRequestLines(request.lines_of_business);
    // Format asked for by the agency:
    // "Regarding: Acme LLC | 2025, 2026 | General Liability, Commercial Property Loss Runs"
    const subject = `Regarding: ${namedInsured} | ${years.join(", ")} | ${lines.join(", ")} Loss Runs`;

    await sendViaResend(
      subject,
      buildLossRunRequestHtml({ namedInsured, years, lines, notes: request.notes ?? "" }),
    );
    return { ok: true };
  });
