import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the service-role client: records every builder call per
// table and answers with the rows the test set for that table.
type Call = [method: string, ...args: unknown[]];
const calls: Record<string, Call[][]> = {};
let tableRows: Record<string, unknown[]> = {};
let insertError: { message: string } | null = null;

function builder(table: string) {
  const log: Call[] = [];
  (calls[table] ??= []).push(log);
  const isInsert = () => log.some(([m]) => m === "insert");
  const result = () =>
    Promise.resolve(
      isInsert()
        ? { data: null, error: insertError }
        : { data: tableRows[table] ?? [], error: null },
    );
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_, prop: string) {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => result().then(resolve);
        if (prop === "maybeSingle") {
          return () => Promise.resolve({ data: (tableRows[table] ?? [])[0] ?? null, error: null });
        }
        return (...args: unknown[]) => {
          log.push([prop, ...args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));
const sendViaResend = vi.fn();
vi.mock("@/lib/claim-notifications.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claim-notifications.server")>()),
  sendViaResend: (...args: unknown[]) => sendViaResend(...args),
}));

const { carrierEmailHtml, deliverCarrierEmail } = await import("./carrier-email.server");

const CLAIM_ID = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";

const input = {
  claimId: CLAIM_ID,
  templateId: TEMPLATE_ID,
  to: "claims@carrier.com",
  subject: "Status Request - Claim 9",
  body: "Hello,\n<b>Thanks</b>",
  actorId: ACTOR,
};

function writes(table: string, method: string) {
  return (calls[table] ?? []).filter((log) => log.some(([m]) => m === method));
}

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  insertError = null;
  sendViaResend.mockReset();
  sendViaResend.mockResolvedValue(undefined);
  tableRows = {
    email_templates: [{ id: TEMPLATE_ID, key: "status_request", name: "Status request" }],
    claims: [{ id: CLAIM_ID, submitted_to_carrier_at: null }],
    agency_settings: [{ broker_claims_email: "claims@brqr.com" }],
  };
});

describe("carrierEmailHtml", () => {
  it("escapes the text and keeps line breaks", () => {
    const html = carrierEmailHtml('A & B\r\n<script>"x"</script>\nEnd');
    expect(html).toContain("A &amp; B<br>\n&lt;script&gt;&quot;x&quot;&lt;/script&gt;<br>\nEnd");
    expect(html).not.toContain("<script>");
  });
});

describe("deliverCarrierEmail", () => {
  it("sends text and HTML to the recipient with the agency inbox as reply-to, then logs it", async () => {
    const res = await deliverCarrierEmail(input);

    expect(sendViaResend).toHaveBeenCalledTimes(1);
    const [subject, html, options] = sendViaResend.mock.calls[0];
    expect(subject).toBe(input.subject);
    expect(html).toContain("&lt;b&gt;Thanks&lt;/b&gt;");
    expect(options).toEqual({
      to: "claims@carrier.com",
      text: input.body,
      replyTo: "claims@brqr.com",
    });

    const [insertLog] = writes("claim_activity", "insert");
    const inserted = insertLog.find(([m]) => m === "insert")?.[1];
    expect(inserted).toEqual({
      claim_id: CLAIM_ID,
      actor_id: ACTOR,
      kind: "email",
      body: "Email sent to carrier (claims@carrier.com): Status request — Status Request - Claim 9",
    });
    expect(res).toEqual({ logged: true, markedSubmitted: false });
    // Not a first notice of loss: the claim isn't touched.
    expect(writes("claims", "update")).toHaveLength(0);
  });

  it("logs nothing and rethrows when the send fails", async () => {
    sendViaResend.mockRejectedValue(new Error("Resend request failed: 422"));
    await expect(deliverCarrierEmail(input)).rejects.toThrow("Resend request failed: 422");
    expect(writes("claim_activity", "insert")).toHaveLength(0);
    expect(writes("claims", "update")).toHaveLength(0);
  });

  it("refuses an unknown template without sending", async () => {
    tableRows.email_templates = [];
    await expect(deliverCarrierEmail(input)).rejects.toThrow("no longer exists");
    expect(sendViaResend).not.toHaveBeenCalled();
  });

  it("refuses an unknown claim without sending", async () => {
    tableRows.claims = [];
    await expect(deliverCarrierEmail(input)).rejects.toThrow("Claim not found");
    expect(sendViaResend).not.toHaveBeenCalled();
  });

  it("sends without reply-to when the agency has no claims inbox set", async () => {
    tableRows.agency_settings = [];
    await deliverCarrierEmail(input);
    expect(sendViaResend.mock.calls[0][2].replyTo).toBeUndefined();
  });

  it("marks the claim submitted to the carrier on a first notice of loss", async () => {
    tableRows.email_templates = [
      { id: TEMPLATE_ID, key: "first_notice_of_loss", name: "First notice of loss" },
    ];
    const res = await deliverCarrierEmail(input);
    const [update] = writes("claims", "update");
    const patch = update.find(([m]) => m === "update")?.[1] as { submitted_to_carrier_at: string };
    expect(Number.isNaN(Date.parse(patch.submitted_to_carrier_at))).toBe(false);
    // Only fills it in if still empty, even if two sends race.
    expect(update).toContainEqual(["is", "submitted_to_carrier_at", null]);
    expect(update).toContainEqual(["eq", "id", CLAIM_ID]);
    expect(res.markedSubmitted).toBe(true);
  });

  it("keeps an existing submitted_to_carrier_at", async () => {
    tableRows.email_templates = [
      { id: TEMPLATE_ID, key: "first_notice_of_loss", name: "First notice of loss" },
    ];
    tableRows.claims = [{ id: CLAIM_ID, submitted_to_carrier_at: "2026-11-01T12:00:00Z" }];
    const res = await deliverCarrierEmail(input);
    expect(writes("claims", "update")).toHaveLength(0);
    expect(res.markedSubmitted).toBe(false);
  });

  it("still reports success when the email went out but the log write failed", async () => {
    insertError = { message: "boom" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await deliverCarrierEmail(input);
    expect(res.logged).toBe(false);
    spy.mockRestore();
  });
});
