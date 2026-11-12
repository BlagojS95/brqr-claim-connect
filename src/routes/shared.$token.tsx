import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { formatDate } from "@/lib/dates";
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
import claimsQrLogoWhite from "@/assets/claims-qr-logo-white.png";

// A shared, read-only report (fixes 44 and 46). No sign-in: the token in the
// address is the key. The server returns only the frozen copy the link was
// made for, so nothing else of the client's (or anyone's) data is reachable.
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
    <div className="min-h-screen bg-background">
      <header className="bg-navy text-navy-foreground">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between gap-3">
          <img src={claimsQrLogoWhite} alt="ClaimsQR" className="h-8 w-auto" />
          <span className="text-xs text-white/70">Read-only shared report</span>
        </div>
        <div className="h-1 bg-gold" />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : !data ? (
          <Unavailable />
        ) : data.kind === SHARED_REPORT_KIND.lossSummary ? (
          <SharedLossSummary snapshot={data.snapshot} expiresAt={data.expiresAt} />
        ) : (
          <Unavailable />
        )}
      </main>
    </div>
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
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-navy">Loss Summary</h1>
          <p className="text-sm text-navy mt-1 font-medium">{report.clientName}</p>
          <p className="text-sm text-muted-foreground">
            {filters} · Valued as of {formatDate(report.valuedAsOf)} · Link expires{" "}
            {new Date(expiresAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
          </p>
        </div>
        <div className="flex gap-2">
          <LossSummaryExport
            summary={summary}
            info={{ valuedAsOf: report.valuedAsOf, client: report.clientName, filters }}
          />
        </div>
      </div>
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
      <p className="text-xs text-muted-foreground">
        Prepared by BRQR Insurance Agency with ClaimsQR. Figures are as of the valuation date and
        may have changed since.
      </p>
    </>
  );
}
