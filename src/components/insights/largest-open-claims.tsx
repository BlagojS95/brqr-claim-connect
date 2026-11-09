import { Link } from "@tanstack/react-router";
import { StatusBadge } from "@/components/status-badge";
import { incurredAmount, paidAmount } from "@/lib/claim-metrics";
import { formatDate } from "@/lib/dates";
import { largestClaimsMeasure } from "@/lib/insights-breakdowns";
import {
  INSIGHTS_MEASURE,
  INSIGHTS_MEASURE_LABELS,
  type InsightsMeasure,
} from "@/lib/insights-measure";
import type { AgencyClaim } from "@/lib/overview.types";
import { ChartCard } from "./chart-card";

// "10 largest open claims" on Insights (fix 35). Plain markup, no recharts, so
// it renders without waiting for the charts chunk.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function ClaimNumber({ claim }: { claim: AgencyClaim }) {
  return claim.claim_number ? (
    <span className="font-medium text-navy">{claim.claim_number}</span>
  ) : (
    <span className="text-xs italic text-muted-foreground">Number pending</span>
  );
}

export function LargestOpenClaims({
  claims,
  measure,
  limit,
}: {
  /** Already ranked, e.g. by largestOpenClaims. */
  claims: AgencyClaim[];
  measure: InsightsMeasure;
  limit: number;
}) {
  const rankBy = largestClaimsMeasure(measure);
  const title = `${limit} Largest Open Claims by ${INSIGHTS_MEASURE_LABELS[rankBy]}`;
  const amount = (c: AgencyClaim) =>
    rankBy === INSIGHTS_MEASURE.paid ? paidAmount(c) : incurredAmount(c);
  const other = (c: AgencyClaim) =>
    rankBy === INSIGHTS_MEASURE.paid ? incurredAmount(c) : paidAmount(c);
  const otherLabel =
    INSIGHTS_MEASURE_LABELS[
      rankBy === INSIGHTS_MEASURE.paid ? INSIGHTS_MEASURE.incurred : INSIGHTS_MEASURE.paid
    ];
  const who = (c: AgencyClaim) => c.claimant_name || c.employee_name || c.client_name;

  return (
    <ChartCard title={title}>
      {claims.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open claims with an amount yet.</p>
      ) : (
        <>
          {/* Phones: one card per claim. */}
          <ol className="space-y-2 md:hidden">
            {claims.map((c) => (
              <li key={c.id}>
                <Link
                  to="/claims/$claimId"
                  params={{ claimId: c.id }}
                  className="block rounded-md border border-border p-3 hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <ClaimNumber claim={c} />
                      <div className="text-sm break-words">{who(c)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-semibold text-navy">{currency.format(amount(c))}</div>
                      <div className="text-xs text-muted-foreground">
                        {otherLabel} {currency.format(other(c))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <StatusBadge status={c.status} />
                    <span>{c.line_of_business}</span>
                    <span>· {c.cause_of_loss ?? "Cause not given"}</span>
                    <span>· {formatDate(c.date_of_loss)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ol>

          {/* Desktop: a table. */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Claim</th>
                  <th className="py-2 pr-3 font-medium">Claimant</th>
                  <th className="py-2 pr-3 font-medium">Line</th>
                  <th className="py-2 pr-3 font-medium">Cause</th>
                  <th className="py-2 pr-3 font-medium">Date of Loss</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium text-right">
                    {INSIGHTS_MEASURE_LABELS[rankBy]}
                  </th>
                  <th className="py-2 font-medium text-right">{otherLabel}</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="py-2 pr-3">
                      <Link
                        to="/claims/$claimId"
                        params={{ claimId: c.id }}
                        className="hover:underline"
                      >
                        <ClaimNumber claim={c} />
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{who(c)}</td>
                    <td className="py-2 pr-3">{c.line_of_business}</td>
                    <td className="py-2 pr-3">{c.cause_of_loss ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDate(c.date_of_loss)}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold text-navy whitespace-nowrap">
                      {currency.format(amount(c))}
                    </td>
                    <td className="py-2 text-right text-muted-foreground whitespace-nowrap">
                      {currency.format(other(c))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ChartCard>
  );
}
