import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { summarize } from "@/lib/claim-metrics";
import { calendarYear, formatDate, todayIso } from "@/lib/dates";
import { sendLossRunRequestEmail } from "@/lib/email.functions";
import { LINE_OF_BUSINESS, lineOfBusinessName } from "@/lib/line-of-business";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import { overviewQueryOptions } from "@/lib/query-keys";
import type { AgencyClaim } from "@/lib/overview.types";
import { InsurGridLossRuns } from "@/components/insurgrid-loss-runs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, FileText, Send, FolderArchive } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/loss-runs")({
  component: LossRunsPage,
});

// Names from the lines_of_business table, so a request names lines the same
// way claims and policies do. "Other" is left off, as before.
const LOB_OPTIONS = [
  LINE_OF_BUSINESS.generalLiability,
  LINE_OF_BUSINESS.workersComp,
  LINE_OF_BUSINESS.auto,
  LINE_OF_BUSINESS.property,
  LINE_OF_BUSINESS.umbrella,
  LINE_OF_BUSINESS.professional,
  LINE_OF_BUSINESS.cyber,
].map(lineOfBusinessName);

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function LossRunsPage() {
  const { clientId, role } = useAuth();
  const qc = useQueryClient();
  const notifyAgency = useServerFn(sendLossRunRequestEmail);

  const { data: lossRuns = [] } = useQuery({
    queryKey: ["loss-runs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("loss_runs")
        .select("*, clients(name, company_name)")
        .order("year", { ascending: false });
      return data ?? [];
    },
  });

  const getOverview = useServerFn(fetchAgencyOverview);
  const {
    data: claims = [],
    isLoading: claimsLoading,
    isError: claimsFailed,
  } = useQuery({
    ...overviewQueryOptions("claims", getOverview),
    select: (overview) => overview.claims,
  });

  // Totals come from the claims themselves so they always match the Claims page.
  // loss_runs rows only supply the attached files for that client and year.
  const yearCards = useMemo(() => {
    const cards = new Map<
      string,
      { key: string; clientName: string; year: number; rows: AgencyClaim[]; files: string[] }
    >();
    const cardFor = (clientId: string, clientName: string, year: number) => {
      const key = `${clientId}|${year}`;
      let card = cards.get(key);
      if (!card) {
        card = { key, clientName, year, rows: [], files: [] };
        cards.set(key, card);
      }
      return card;
    };
    for (const c of claims) {
      // Year 0 is the "No date" card, so every claim is counted somewhere.
      cardFor(c.client_id, c.client_name, calendarYear(c.date_of_loss) ?? 0).rows.push(c);
    }
    for (const lr of lossRuns) {
      const name = lr.clients?.company_name || lr.clients?.name || "";
      const card = cardFor(lr.client_id, name, lr.year);
      if (lr.document_url) card.files.push(lr.document_url);
    }
    return Array.from(cards.values()).sort(
      (a, b) => b.year - a.year || a.clientName.localeCompare(b.clientName),
    );
  }, [claims, lossRuns]);

  const valued = formatDate(todayIso());

  // document_url holds the storage path; sign it at click time so links never go stale
  const download = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("claim-documents")
      .createSignedUrl(path, 60, { download: true });
    if (error || !data) {
      toast.error("Could not open the file");
      return;
    }
    window.location.assign(data.signedUrl);
  };

  const { data: requests = [] } = useQuery({
    queryKey: ["loss-run-requests"],
    queryFn: async () => {
      const { data } = await supabase
        .from("loss_run_requests")
        .select("*")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const currentYear = new Date().getFullYear();
  const yearChoices = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];

  const [years, setYears] = useState<number[]>([currentYear]);
  const [lobs, setLobs] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("Missing client profile");
      if (years.length === 0) throw new Error("Select at least one year");
      if (lobs.length === 0) throw new Error("Select at least one line of business");
      const { data: request, error } = await supabase
        .from("loss_run_requests")
        .insert({
          client_id: clientId,
          years,
          lines_of_business: lobs,
          notes: notes || null,
        })
        .select("id")
        .single();
      if (error) throw error;

      // The request is already saved; a failed email shouldn't look like a failed request.
      try {
        await notifyAgency({ data: { requestId: request.id } });
      } catch (err) {
        console.warn("loss run email error", err);
      }
    },
    onSuccess: () => {
      toast.success("Loss run request submitted");
      setYears([currentYear]);
      setLobs([]);
      setNotes("");
      qc.invalidateQueries({ queryKey: ["loss-run-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = <T,>(arr: T[], v: T, set: (a: T[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-navy">Loss Runs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Access historical loss run reports and request new ones from your agent.
        </p>
      </div>

      {/* Holder */}
      <section className="rounded-lg border border-border bg-card">
        <div className="p-5 border-b border-border flex items-center gap-2">
          <FolderArchive className="h-4 w-4 text-gold" />
          <h2 className="font-semibold text-navy">Loss Run Library</h2>
        </div>
        <div className="p-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {yearCards.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full">No loss runs available yet.</p>
          )}
          {yearCards.map((card) => {
            const totals = summarize(card.rows);
            return (
              <div key={card.key} className="rounded-md border border-border p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="font-semibold text-navy text-lg">{card.year || "No date"}</div>
                  {card.files.length > 0 ? (
                    <div className="flex flex-col items-end gap-1">
                      {card.files.map((path, i) => (
                        <button
                          key={path}
                          type="button"
                          onClick={() => download(path)}
                          className="inline-flex items-center gap-1 text-xs text-navy hover:text-gold"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download{card.files.length > 1 ? ` ${i + 1}` : ""}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">No file</span>
                  )}
                </div>
                {role === "agency_admin" && card.clientName && (
                  <div className="text-xs text-navy mb-1">{card.clientName}</div>
                )}
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {claimsLoading ? (
                    <div>Loading totals…</div>
                  ) : claimsFailed ? (
                    <div>Totals could not be loaded.</div>
                  ) : totals.claims === 0 ? (
                    <div>See the attached file. No claims on file in the portal for this year.</div>
                  ) : (
                    <>
                      <div>{totals.claims} claims</div>
                      <div>Paid: {fmt(totals.paid)}</div>
                      <div>Incurred: {fmt(totals.incurred)}</div>
                      <div>Valued as of {valued}</div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Requester */}
      <section className="rounded-lg border border-border bg-card">
        <div className="p-5 border-b border-border flex items-center gap-2">
          <Send className="h-4 w-4 text-gold" />
          <h2 className="font-semibold text-navy">Request a Loss Run</h2>
        </div>
        <Tabs defaultValue="insurgrid" className="p-5">
          <TabsList>
            <TabsTrigger value="insurgrid">Request through InsurGrid</TabsTrigger>
            <TabsTrigger value="manual">Request Manually</TabsTrigger>
          </TabsList>

          <TabsContent value="insurgrid" className="pt-4">
            <InsurGridLossRuns />
          </TabsContent>

          <TabsContent value="manual" className="pt-4 space-y-5">
            <div>
              <Label className="text-sm font-medium text-navy">Years</Label>
              <div className="flex flex-wrap gap-3 mt-2">
                {yearChoices.map((y) => (
                  <label key={y} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={years.includes(y)}
                      onCheckedChange={() => toggle(years, y, setYears)}
                    />
                    {y}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium text-navy">Lines of Business</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                {LOB_OPTIONS.map((l) => (
                  <label key={l} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={lobs.includes(l)} onCheckedChange={() => toggle(lobs, l, setLobs)} />
                    {l}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="notes" className="text-sm font-medium text-navy">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything else we should know…"
                className="mt-2"
                rows={3}
              />
            </div>

            <Button
              onClick={() => submit.mutate()}
              disabled={submit.isPending}
              className="bg-navy hover:bg-navy/90 text-navy-foreground"
            >
              {submit.isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </TabsContent>
        </Tabs>
      </section>

      {/* Past Requests */}
      <section className="rounded-lg border border-border bg-card">
        <div className="p-5 border-b border-border flex items-center gap-2">
          <FileText className="h-4 w-4 text-gold" />
          <h2 className="font-semibold text-navy">Your Requests</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Years</th>
                <th className="text-left p-3">Lines</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No requests yet.</td></tr>
              )}
              {requests.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-3">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="p-3">{(r.years ?? []).join(", ")}</td>
                  <td className="p-3 text-xs">{(r.lines_of_business ?? []).join(", ")}</td>
                  <td className="p-3">
                    <span className="text-xs px-2 py-1 rounded-full bg-muted/60 text-navy">{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
