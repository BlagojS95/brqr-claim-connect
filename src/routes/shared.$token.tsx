import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  DEFAULT_LOSS_SUMMARY_SORT,
  buildLossSummary,
  lossSummaryFilterLabel,
  nextLossSummarySort,
  type LossSummarySort,
} from "@/lib/loss-summary";
import { fetchSharedReport } from "@/lib/shared-reports.functions";
import { LossSummarySnapshotSchema, SHARED_REPORT_KIND } from "@/lib/shared-reports";
import { LossSummaryExport } from "@/components/reports/loss-summary-export";
import { LossSummaryTable } from "@/components/reports/loss-summary-table";
import { ExecutiveReportView } from "@/components/reports/executive-report-view";
import {
  SharedReportFooter,
  SharedReportFrame,
  SharedReportHeader,
} from "@/components/shared/shared-report-layout";
import { Button } from "@/components/ui/button";
import { downloadSharedExecutiveReport } from "@/lib/executive-report.functions";
import { downloadBase64 } from "@/lib/exports/download";
import type { ExecutiveReport } from "@/lib/executive-report";
import { FileText } from "lucide-react";
import { toast } from "sonner";

// A shared, read-only report (fixes 44, 46 and 57). No sign-in: the token in
// the address is the key. The server returns only the frozen copy the link was
// made for, so nothing else of the client's (or anyone's) data is reachable.
// The page is a minimal branded frame: logo, title, client, valuation date and
// expiry, the report itself, and no navigation.
export const Route = createFileRoute("/shared/$token")({
  head: () => ({
    meta: [
      { title: "Shared report | ClaimsQR" },
      // Keep the link out of search engines and out of Referer headers.
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: SharedReportPage,
});

function SharedReportPage() {
  const { token } = Route.useParams();
  const getShared = useServerFn(fetchSharedReport);
  const { data, isLoading } = useQuery({
    queryKey: ["shared-report", token],
    queryFn: () => getShared({ data: { token } }),
    retry: false,
    staleTime: Infinity,
  });

  return (
    <SharedReportFrame>
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !data ? (
        <Unavailable />
      ) : data.kind === SHARED_REPORT_KIND.lossSummary ? (
        <SharedLossSummary snapshot={data.snapshot} expiresAt={data.expiresAt} />
      ) : data.kind === SHARED_REPORT_KIND.executiveReport ? (
        <SharedExecutiveReport token={token} snapshot={data.snapshot} expiresAt={data.expiresAt} />
      ) : (
        <Unavailable />
      )}
    </SharedReportFrame>
  );
}

function Unavailable() {
  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-2">
      <h1 className="text-xl font-bold text-navy">This link isn't available</h1>
      <p className="text-sm text-muted-foreground">
        It may have expired or been revoked. Ask the person who shared it for a new link.
      </p>
    </div>
  );
}

function SharedLossSummary({ snapshot, expiresAt }: { snapshot: unknown; expiresAt: string }) {
  const parsed = useMemo(() => LossSummarySnapshotSchema.safeParse(snapshot), [snapshot]);
  const [sort, setSort] = useState<LossSummarySort>(DEFAULT_LOSS_SUMMARY_SORT);
  const summary = useMemo(
    () => (parsed.success ? buildLossSummary(parsed.data.claims, sort) : null),
    [parsed, sort],
  );
  if (!parsed.success || !summary) return <Unavailable />;
  const report = parsed.data;
  const filters = lossSummaryFilterLabel(report.filters);

  return (
    <>
      <SharedReportHeader
        title="Loss Summary"
        clientName={report.clientName}
        valuedAsOf={report.valuedAsOf}
        expiresAt={expiresAt}
        detail={filters}
        actions={
          <LossSummaryExport
            summary={summary}
            info={{ valuedAsOf: report.valuedAsOf, client: report.clientName, filters }}
          />
        }
      />
      {summary.totals.claims === 0 ? (
        <p className="text-sm text-muted-foreground">No claims in this report.</p>
      ) : (
        <LossSummaryTable
          summary={summary}
          sort={sort}
          onSort={(key) => setSort((s) => nextLossSummarySort(s, key))}
          linkClaims={false}
        />
      )}
      <SharedReportFooter />
    </>
  );
}

function isExecutiveReport(value: unknown): value is ExecutiveReport {
  const r = value as Partial<ExecutiveReport> | null;
  return !!r && r.version === 1 && !!r.headline && !!r.period && !!r.comparison;
}

function SharedExecutiveReport({
  token,
  snapshot,
  expiresAt,
}: {
  token: string;
  snapshot: unknown;
  expiresAt: string;
}) {
  const getPdf = useServerFn(downloadSharedExecutiveReport);
  const [busy, setBusy] = useState(false);
  if (!isExecutiveReport(snapshot)) return <Unavailable />;

  const download = async () => {
    setBusy(true);
    try {
      const file = await getPdf({ data: { token } });
      if (!file) throw new Error("This link is no longer available");
      downloadBase64(file.base64, file.fileName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the PDF");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SharedReportHeader
        title="Executive Loss Report"
        clientName={snapshot.clientName}
        valuedAsOf={snapshot.valuedAsOf}
        expiresAt={expiresAt}
        actions={
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void download()}>
            <FileText className="h-4 w-4" aria-hidden />
            {busy ? "Creating PDF…" : "Download PDF"}
          </Button>
        }
      />
      <ExecutiveReportView report={snapshot} />
      <SharedReportFooter />
    </>
  );
}
