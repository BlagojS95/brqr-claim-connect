import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Mail, Presentation } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { formatDate, todayIso } from "@/lib/dates";
import { DEFAULT_LARGE_LOSS_THRESHOLD, type ExecutiveReport } from "@/lib/executive-report";
import {
  createExecutiveReportShare,
  downloadExecutiveReport,
  fetchReportSchedule,
  generateExecutiveReport,
  sendTestExecutiveReport,
  setMonthlyReportEnabled,
  setReportSchedule,
} from "@/lib/executive-report.functions";
import { downloadBase64 } from "@/lib/exports/download";
import { currentPolicyTerm, parseIsoDate } from "@/lib/insights-period";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import { overviewQueryOptions, queryKeys } from "@/lib/query-keys";
import {
  COMPARISONS,
  COMPARISON_LABELS,
  REPORT_PERIODS,
  REPORT_PERIOD_LABELS,
  resolveComparison,
  resolveReportPeriod,
  type Comparison,
  type ReportPeriod,
} from "@/lib/report-periods";
import { SHARED_REPORT_KIND } from "@/lib/shared-reports";
import { CLIENT_USER_ROLE } from "@/lib/client-users";
import { ExecutiveReportView } from "@/components/reports/executive-report-view";
import { ShareReportButton, SharedLinksList } from "@/components/reports/share-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const field = "flex flex-col gap-1 min-w-0";
const labelClass = "text-xs uppercase tracking-wide text-muted-foreground";
const selectClass =
  "h-10 md:h-9 rounded-md border border-input bg-background px-3 text-base md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Reports > Executive Report (fix 46).
export function ExecutiveReportTab() {
  const { role, clientId: ownClientId, clientRole } = useAuth();
  const isAgency = role === "agency_admin";
  const getOverview = useServerFn(fetchAgencyOverview);
  const { data: overview } = useQuery(overviewQueryOptions("all", getOverview));

  const [pickedClient, setPickedClient] = useState("");
  const clientId = isAgency ? pickedClient : (ownClientId ?? "");
  const clients = useMemo(
    () =>
      [...(overview?.clients ?? [])]
        .map((c) => ({ id: c.id, name: c.company_name || c.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [overview],
  );
  const policies = useMemo(
    () => (overview?.policies ?? []).filter((p) => p.client_id === clientId),
    [overview, clientId],
  );

  const today = todayIso();
  const [preset, setPreset] = useState<ReportPeriod>("ytd");
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [comparisonKind, setComparisonKind] = useState<Comparison>("prior-year");
  const [customComparison, setCustomComparison] = useState<{ from?: string; to?: string }>({});
  const [threshold, setThreshold] = useState(String(DEFAULT_LARGE_LOSS_THRESHOLD));
  const [notes, setNotes] = useState("");
  const [report, setReport] = useState<ExecutiveReport | null>(null);

  const period = resolveReportPeriod(preset, today, policies, custom);
  const comparison = period ? resolveComparison(comparisonKind, period, customComparison) : null;
  const thresholdValue = Number(threshold);
  const policyTerm = currentPolicyTerm(policies, today);
  const ready =
    !!clientId &&
    !!period &&
    !!comparison &&
    Number.isFinite(thresholdValue) &&
    thresholdValue >= 0;
  const request = ready
    ? {
        clientId,
        period: period!,
        comparison: comparison!,
        threshold: thresholdValue,
        brokerNotes: isAgency && notes.trim() ? notes.trim() : undefined,
      }
    : null;

  const generate = useServerFn(generateExecutiveReport);
  const download = useServerFn(downloadExecutiveReport);
  const share = useServerFn(createExecutiveReportShare);
  const sendTest = useServerFn(sendTestExecutiveReport);

  const run = useMutation({
    mutationFn: () => generate({ data: request! }),
    onSuccess: setReport,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't create the report"),
  });
  const pdf = useMutation({
    mutationFn: () => download({ data: request! }),
    onSuccess: (file) => downloadBase64(file.base64, file.fileName),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't create the PDF"),
  });
  const test = useMutation({
    mutationFn: () => sendTest({ data: request! }),
    onSuccess: ({ to }) => toast.success(`Test report sent to ${to}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't send the test"),
  });

  const canShare = isAgency || clientRole === CLIENT_USER_ROLE.clientAdmin;
  const clientName = clients.find((c) => c.id === clientId)?.name;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-navy flex items-center gap-2">
          <Presentation className="h-6 w-6 text-gold" /> Executive Loss Report
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          A PDF summary of a period against a comparison period: headline, loss ratios, large
          losses, aging, reserve changes, frequency and severity, workers comp, litigation and
          recoveries.
        </p>
      </div>

      <form
        className="rounded-lg border border-border bg-card p-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) run.mutate();
        }}
      >
        {isAgency && (
          <div className={field}>
            <label htmlFor="er-client" className={labelClass}>
              Client
            </label>
            <select
              id="er-client"
              value={pickedClient}
              onChange={(e) => {
                setPickedClient(e.target.value);
                setReport(null);
              }}
              className={selectClass}
            >
              <option value="">Pick a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className={field}>
          <label htmlFor="er-period" className={labelClass}>
            Period (date of loss)
          </label>
          <select
            id="er-period"
            value={preset}
            onChange={(e) => setPreset(e.target.value as ReportPeriod)}
            className={selectClass}
          >
            {REPORT_PERIODS.map((p) => (
              <option key={p} value={p} disabled={p === "policy" && !policyTerm}>
                {p === "policy" && !policyTerm
                  ? "Policy year (none in force)"
                  : REPORT_PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
          {preset === "custom" ? (
            <DateRangeInputs idPrefix="er-period" value={custom} onChange={setCustom} />
          ) : (
            period && (
              <span className="text-xs text-muted-foreground">
                {formatDate(period.from)} – {formatDate(period.to)}
              </span>
            )
          )}
        </div>

        <div className={field}>
          <label htmlFor="er-comparison" className={labelClass}>
            Compare with
          </label>
          <select
            id="er-comparison"
            value={comparisonKind}
            onChange={(e) => setComparisonKind(e.target.value as Comparison)}
            className={selectClass}
          >
            {COMPARISONS.map((c) => (
              <option key={c} value={c}>
                {COMPARISON_LABELS[c]}
              </option>
            ))}
          </select>
          {comparisonKind === "custom" ? (
            <DateRangeInputs
              idPrefix="er-comparison"
              value={customComparison}
              onChange={setCustomComparison}
            />
          ) : (
            comparison && (
              <span className="text-xs text-muted-foreground">
                {formatDate(comparison.from)} – {formatDate(comparison.to)}
              </span>
            )
          )}
        </div>

        <div className={field}>
          <label htmlFor="er-threshold" className={labelClass}>
            Large loss threshold (incurred, $)
          </label>
          <Input
            id="er-threshold"
            type="number"
            min={0}
            step={1000}
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>

        {isAgency && (
          <div className={`${field} md:col-span-2`}>
            <label htmlFor="er-notes" className={labelClass}>
              Broker notes (shown in the report)
            </label>
            <Textarea
              id="er-notes"
              rows={3}
              maxLength={4000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Commentary for the client: trends, actions, renewal outlook…"
            />
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 md:col-span-2 lg:col-span-3">
          <Button
            type="submit"
            disabled={!ready || run.isPending}
            className="bg-navy hover:bg-navy/90 text-navy-foreground"
          >
            {run.isPending ? "Generating…" : "Generate report"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!ready || pdf.isPending}
            onClick={() => pdf.mutate()}
          >
            <FileText className="h-4 w-4" aria-hidden />
            {pdf.isPending ? "Creating PDF…" : "Download PDF"}
          </Button>
          {canShare && (
            <ShareReportButton
              title="Share this report"
              description={`A read-only copy of the ${clientName ?? "client"} report for this period, as of today.`}
              disabled={!ready}
              disabledReason="Pick a client and a period first"
              createLink={(days) => share({ data: { ...request!, days } })}
            />
          )}
          {!ready && (
            <span className="text-xs text-muted-foreground">
              {!clientId ? "Pick a client." : "Pick a valid period and comparison."}
            </span>
          )}
        </div>
      </form>

      {clientId && (
        <MonthlyEmail
          clientId={clientId}
          threshold={
            Number.isFinite(thresholdValue) ? thresholdValue : DEFAULT_LARGE_LOSS_THRESHOLD
          }
          isAgency={isAgency}
          onSendTest={ready ? () => test.mutate() : undefined}
          sendingTest={test.isPending}
        />
      )}

      {report && <ExecutiveReportView report={report} />}

      {canShare && (
        <SharedLinksList
          kind={SHARED_REPORT_KIND.executiveReport}
          clientId={clientId || undefined}
        />
      )}
    </div>
  );
}

function DateRangeInputs({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: { from?: string; to?: string };
  onChange: (next: { from?: string; to?: string }) => void;
}) {
  return (
    <div className="flex gap-2">
      <Input
        id={`${idPrefix}-from`}
        type="date"
        aria-label="From"
        value={value.from ?? ""}
        onChange={(e) => onChange({ ...value, from: parseIsoDate(e.target.value) ?? undefined })}
      />
      <Input
        id={`${idPrefix}-to`}
        type="date"
        aria-label="To"
        value={value.to ?? ""}
        onChange={(e) => onChange({ ...value, to: parseIsoDate(e.target.value) ?? undefined })}
      />
    </div>
  );
}

// "Email me this report monthly", plus the agency's master switch.
function MonthlyEmail({
  clientId,
  threshold,
  isAgency,
  onSendTest,
  sendingTest,
}: {
  clientId: string;
  threshold: number;
  isAgency: boolean;
  onSendTest?: () => void;
  sendingTest: boolean;
}) {
  const queryClient = useQueryClient();
  const fetchSchedule = useServerFn(fetchReportSchedule);
  const saveSchedule = useServerFn(setReportSchedule);
  const saveAgency = useServerFn(setMonthlyReportEnabled);
  const { data } = useQuery({
    queryKey: queryKeys.reportSchedule(clientId),
    queryFn: () => fetchSchedule({ data: { clientId } }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["report-schedule"] });

  const schedule = useMutation({
    mutationFn: (on: boolean) => saveSchedule({ data: { clientId, on, threshold } }),
    onSuccess: (_r, on) => {
      toast.success(
        on ? "You'll get this report on the 2nd of each month" : "Monthly report stopped",
      );
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });
  const agency = useMutation({
    mutationFn: (enabled: boolean) => saveAgency({ data: { enabled } }),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });

  if (!data?.canSchedule) return null;
  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-navy flex items-center gap-2">
        <Mail className="h-4 w-4 text-gold" aria-hidden /> Monthly email
      </h3>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={data.scheduled}
          disabled={schedule.isPending}
          onCheckedChange={(on) => schedule.mutate(on)}
        />
        Email me this report monthly (last month vs the same month last year)
      </label>
      {isAgency && (
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={data.agencyEnabled}
            disabled={agency.isPending}
            onCheckedChange={(on) => agency.mutate(on)}
          />
          Monthly report emails are {data.agencyEnabled ? "on" : "off"} for everyone (agency switch)
        </label>
      )}
      {!data.agencyEnabled && (
        <p className="text-xs text-muted-foreground">
          Monthly emails are switched off by BRQR for now, so nothing is sent yet.
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!onSendTest || sendingTest}
        onClick={onSendTest}
      >
        {sendingTest ? "Sending…" : "Send me a test now"}
      </Button>
    </section>
  );
}
