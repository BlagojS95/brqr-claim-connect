import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, FileText, Send, FolderArchive } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/loss-runs")({
  component: LossRunsPage,
});

const LOB_OPTIONS = [
  "General Liability",
  "Workers Compensation",
  "Commercial Auto",
  "Property",
  "Umbrella",
  "Professional Liability",
  "Cyber",
];

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function LossRunsPage() {
  const { clientId } = useAuth();
  const qc = useQueryClient();

  const { data: lossRuns = [] } = useQuery({
    queryKey: ["loss-runs"],
    queryFn: async () => {
      const { data } = await supabase.from("loss_runs").select("*").order("year", { ascending: false });
      return data ?? [];
    },
  });

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
      const { error } = await supabase.from("loss_run_requests").insert({
        client_id: clientId,
        years,
        lines_of_business: lobs,
        notes: notes || null,
      });
      if (error) throw error;
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
    <div className="space-y-8 max-w-6xl">
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
          {lossRuns.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full">No loss runs available yet.</p>
          )}
          {lossRuns.map((lr) => (
            <div key={lr.id} className="rounded-md border border-border p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-navy text-lg">{lr.year}</div>
                {lr.document_url ? (
                  <a
                    href={lr.document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-navy hover:text-gold"
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">No file</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>{lr.total_claims ?? 0} claims</div>
                <div>Paid: {fmt(Number(lr.total_paid ?? 0))}</div>
                <div>Incurred: {fmt(Number(lr.total_incurred ?? 0))}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Requester */}
      <section className="rounded-lg border border-border bg-card">
        <div className="p-5 border-b border-border flex items-center gap-2">
          <Send className="h-4 w-4 text-gold" />
          <h2 className="font-semibold text-navy">Request a Loss Run</h2>
        </div>
        <div className="p-5 space-y-5">
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
        </div>
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
