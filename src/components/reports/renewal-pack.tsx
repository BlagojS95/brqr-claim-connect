import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileStack } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatDate, todayIso } from "@/lib/dates";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import { overviewQueryOptions } from "@/lib/query-keys";
import {
  buildRenewalSection,
  formatLossRatio,
  renewalLineChoices,
  type LineOfBusinessRow,
} from "@/lib/renewal-pack";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const ALL_CLIENTS = "";

/**
 * The "Renewal pack" tab on /reports (fix 36): pick lines of business and
 * download one PDF with five policy years of losses against premium per line.
 */
export function RenewalPack() {
  const { role } = useAuth();
  const isAdmin = role === "agency_admin";
  const getOverview = useServerFn(fetchAgencyOverview);
  const { data: overview, isLoading, isError } = useQuery(overviewQueryOptions("all", getOverview));

  // Same key and shape as the claim form's query, so they share the cache.
  const { data: lines = [], isLoading: linesLoading } = useQuery({
    queryKey: ["lines-of-business"],
    queryFn: async (): Promise<LineOfBusinessRow[]> => {
      const { data, error } = await supabase
        .from("lines_of_business")
        .select("id, name, code")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const [clientId, setClientId] = useState(ALL_CLIENTS);
  // null until the user changes something: then the default is every line with a policy.
  const [picked, setPicked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const today = todayIso();

  const clients = useMemo(
    () =>
      (overview?.clients ?? [])
        .filter((c) => c.claims_count > 0 || overview?.policies.some((p) => p.client_id === c.id))
        .map((c) => ({ id: c.id, name: c.company_name || c.name })),
    [overview],
  );
  const { claims, policies } = useMemo(() => {
    const all = { claims: overview?.claims ?? [], policies: overview?.policies ?? [] };
    if (clientId === ALL_CLIENTS) return all;
    return {
      claims: all.claims.filter((c) => c.client_id === clientId),
      policies: all.policies.filter((p) => p.client_id === clientId),
    };
  }, [overview, clientId]);

  const choices = useMemo(
    () => renewalLineChoices(claims, policies, lines),
    [claims, policies, lines],
  );
  const selected = useMemo(
    () => (picked ?? choices.withPolicies).filter((l) => choices.all.includes(l)),
    [picked, choices],
  );
  const sections = useMemo(
    () =>
      choices.all
        .filter((line) => selected.includes(line))
        .map((line) => buildRenewalSection(line, claims, policies, lines, today)),
    [choices.all, selected, claims, policies, lines, today],
  );

  const clientName = isAdmin
    ? (clients.find((c) => c.id === clientId)?.name ??
      (clients.length === 1 ? clients[0].name : undefined))
    : overview?.clients[0]
      ? overview.clients[0].company_name || overview.clients[0].name
      : undefined;

  const toggle = (line: string) =>
    setPicked(selected.includes(line) ? selected.filter((l) => l !== line) : [...selected, line]);

  const download = async () => {
    setBusy(true);
    try {
      const { downloadRenewalPackPdf } = await import("@/lib/exports/renewal-pack-pdf");
      await downloadRenewalPackPdf(sections, { today, client: clientName });
    } catch (err) {
      console.error("renewal pack failed", err);
      toast.error("The renewal pack could not be created. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const loading = isLoading || linesLoading;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-navy flex items-center gap-2">
          <FileStack className="h-6 w-6 text-gold" /> Renewal Pack
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Five policy years of claims against premium for each line of business, in one PDF for your
          renewal. Valued as of {formatDate(today)}.
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <p className="text-sm text-destructive">Your policies and claims could not be loaded.</p>
      )}

      {!loading && !isError && (
        <section className="rounded-lg border border-border bg-card p-4 sm:p-5 space-y-5">
          {isAdmin && clients.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="renewal-client" className="text-sm font-medium text-navy">
                Client
              </Label>
              <select
                id="renewal-client"
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  setPicked(null);
                }}
                className="w-full sm:w-80 h-10 rounded-md border border-input bg-background px-3 text-base"
              >
                <option value={ALL_CLIENTS}>All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-navy">Lines of business</legend>
            {choices.all.length === 0 ? (
              <p className="text-sm text-muted-foreground">No policies or claims on file yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                {choices.all.map((line) => (
                  <label
                    key={line}
                    className="flex items-center gap-3 rounded-md px-2 py-2.5 text-sm cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selected.includes(line)}
                      onCheckedChange={() => toggle(line)}
                    />
                    <span className="min-w-0">
                      {line}
                      {!choices.withPolicies.includes(line) && (
                        <span className="block text-xs text-muted-foreground">
                          No policy on file
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <Button
            onClick={() => void download()}
            disabled={busy || sections.length === 0}
            className="w-full sm:w-auto bg-navy hover:bg-navy/90 text-navy-foreground"
          >
            <Download className="h-4 w-4" aria-hidden />
            {busy ? "Creating PDF…" : "Download renewal pack"}
          </Button>
        </section>
      )}

      {sections.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {sections.map((s) => (
            <section
              key={s.line}
              className="rounded-lg border border-border bg-card overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-border bg-muted/30">
                <h3 className="font-semibold text-navy">{s.line}</h3>
                <p className="text-xs text-muted-foreground">
                  {s.totals.claims} {s.totals.claims === 1 ? "claim" : "claims"} ·{" "}
                  {fmt(s.totals.incurred)} incurred · loss ratio{" "}
                  {formatLossRatio(s.totals.lossRatio)}
                </p>
              </div>
              <ul className="divide-y divide-border text-sm">
                {s.years.map((y) => (
                  <li key={y.year} className="px-4 py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-medium text-navy">{y.year}</span>
                      {y.developing && (
                        <span className="ml-2 text-xs italic text-muted-foreground">
                          still developing
                        </span>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {y.claims} {y.claims === 1 ? "claim" : "claims"} · premium{" "}
                        {y.premium === null ? "—" : fmt(y.premium)}
                        {s.isWorkersComp && y.experienceMods.length > 0 && (
                          <> · mod {y.experienceMods.map((m) => m.toFixed(2)).join(" / ")}</>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <div>{fmt(y.incurred)}</div>
                      <div className="text-xs text-muted-foreground">
                        LR {formatLossRatio(y.lossRatio)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
