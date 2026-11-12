import type { ReactNode } from "react";
import { formatDate } from "@/lib/dates";
import {
  WC_CLAIM_KIND_LABELS,
  type ExecutiveReport,
  type FrequencyRow,
  type ReportClaimRow,
} from "@/lib/executive-report";
import type { ClaimTotals } from "@/lib/claim-metrics";
import { formatLossRatio } from "@/lib/renewal-pack";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const pct = (n: number | null) =>
  n === null ? "—" : `${n > 0 ? "▲" : n < 0 ? "▼" : ""} ${Math.abs(n).toFixed(1)}%`;
const range = (r: { from: string; to: string }) => `${formatDate(r.from)} – ${formatDate(r.to)}`;
const claimNo = (r: ReportClaimRow) => r.claimNumber?.trim() || "Pending";

/**
 * The executive loss report on screen (fix 46): the same sections and numbers
 * as the PDF. Used on Reports and on a shared read-only link.
 */
export function ExecutiveReportView({ report }: { report: ExecutiveReport }) {
  const h = report.headline;
  const headline: { label: string; key: keyof ClaimTotals; money?: boolean }[] = [
    { label: "New claims", key: "claims" },
    { label: "Open (today)", key: "open" },
    { label: "Closed (today)", key: "closed" },
    { label: "Paid", key: "paid", money: true },
    { label: "Reserve", key: "reserve", money: true },
    { label: "Incurred", key: "incurred", money: true },
  ];
  const lr = report.lossRatio;
  const wc = report.workersComp;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="text-lg font-bold text-navy">{report.clientName}</h3>
        <p className="text-sm text-muted-foreground">
          {range(report.period)} compared with {range(report.comparison)} · Valued as of{" "}
          {formatDate(report.valuedAsOf)}
        </p>
      </div>

      <Section
        title="Headline"
        note="Claims counted by date of loss; open and closed are each claim's status today. Same figures as Insights for this period."
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {headline.map((item) => {
            const change = h.change[item.key];
            const fmt = (n: number) => (item.money ? money(n) : String(n));
            return (
              <div key={item.key} className="rounded-md border border-border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {item.label}
                </div>
                <div className="text-xl font-bold text-navy">{fmt(h.current[item.key])}</div>
                <div className="text-xs text-muted-foreground">
                  vs {fmt(h.comparison[item.key])} · {pct(change)}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="Loss ratio by line of business"
        note="Earned premium is each policy's premium pro rata for the days of its term inside the period."
      >
        <Table
          head={["Line", "Claims", "Incurred", "Earned premium", "Loss ratio"]}
          numeric={[1, 2, 3, 4]}
          rows={lr.rows.map((r) => [
            r.line,
            r.claims,
            money(r.incurred),
            r.earnedPremium === null ? "—" : money(r.earnedPremium),
            formatLossRatio(r.ratio),
          ])}
          foot={[
            lr.total.line,
            lr.total.claims,
            money(lr.total.incurred),
            lr.total.earnedPremium === null ? "—" : money(lr.total.earnedPremium),
            formatLossRatio(lr.total.ratio),
          ]}
        />
      </Section>

      <Section title={`Large losses (incurred ${money(report.threshold)} or more)`}>
        {report.largeLosses.length ? (
          <ClaimTable rows={report.largeLosses} />
        ) : (
          <Muted>No claims in the period reached the threshold.</Muted>
        )}
      </Section>

      <Section
        title="Open-claim aging"
        note={`All ${report.aging.open} claims open today, whatever their date of loss. Age counts from the date reported.`}
      >
        <Table
          head={["Age", "Open claims", "Incurred"]}
          numeric={[1, 2]}
          rows={report.aging.buckets.map((b) => [b.label, b.count, money(b.incurred)])}
        />
        {report.aging.oldest.length > 0 && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Oldest open claims
            </div>
            <Table
              head={["Claim #", "Date of loss", "Line", "Days open", "Incurred"]}
              numeric={[3, 4]}
              rows={report.aging.oldest.map((r) => [
                claimNo(r),
                r.dateOfLoss ? formatDate(r.dateOfLoss) : "—",
                r.line,
                r.ageDays,
                money(r.incurred),
              ])}
            />
          </div>
        )}
      </Section>

      <Section
        title="Largest reserve changes in the period"
        note={
          report.reserveChanges.historySince
            ? `Reserve changes are recorded from ${formatDate(report.reserveChanges.historySince.slice(0, 10))}.`
            : "Reserve changes are recorded from the day this report was introduced."
        }
      >
        {report.reserveChanges.rows.length ? (
          <Table
            head={["Claim #", "Line", "Before", "After", "Change"]}
            numeric={[2, 3, 4]}
            rows={report.reserveChanges.rows.map((r) => [
              claimNo(r),
              r.line,
              money(r.from),
              money(r.to),
              `${r.change > 0 ? "+" : "−"}${money(Math.abs(r.change))}`,
            ])}
          />
        ) : (
          <Muted>No reserve changes recorded in the period.</Muted>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-3">
        <FrequencySection title="By cause" rows={report.frequencySeverity.cause} />
        <FrequencySection title="By location" rows={report.frequencySeverity.location} />
        <FrequencySection title="By line" rows={report.frequencySeverity.line} />
      </div>

      <Section title="Workers compensation">
        {wc.claims ? (
          <Table
            head={["", "Claims", "Incurred"]}
            numeric={[1, 2]}
            rows={[
              [WC_CLAIM_KIND_LABELS.lost_time, wc.lostTime.count, money(wc.lostTime.incurred)],
              [
                WC_CLAIM_KIND_LABELS.medical_only,
                wc.medicalOnly.count,
                money(wc.medicalOnly.incurred),
              ],
              ["Not recorded", wc.notRecorded.count, money(wc.notRecorded.incurred)],
            ]}
          />
        ) : (
          <Muted>No workers compensation claims in the period.</Muted>
        )}
        {wc.experienceMods.length > 0 && (
          <div className="mt-4">
            <Table
              head={["Policy", "Term", "Experience mod"]}
              numeric={[2]}
              rows={wc.experienceMods.map((m) => [m.policyNumber, m.term, m.mod.toFixed(2)])}
            />
          </div>
        )}
      </Section>

      <Section title="Litigated claims and recoveries">
        <Table
          head={["", "Claims", "Amount"]}
          numeric={[1, 2]}
          rows={[
            [
              "Litigated claims (incurred)",
              report.litigation.count,
              money(report.litigation.incurred),
            ],
            [
              "Recoveries (subrogation, salvage)",
              report.recoveries.claims,
              money(report.recoveries.total),
            ],
            ["Net incurred after recoveries", "", money(report.recoveries.netIncurred)],
          ]}
        />
        {report.litigation.claims.length > 0 && (
          <div className="mt-4">
            <ClaimTable rows={report.litigation.claims} />
          </div>
        )}
      </Section>

      <Section title="Broker notes">
        <p className="text-sm whitespace-pre-wrap">{report.brokerNotes ?? "None."}</p>
      </Section>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-3">
      <h4 className="text-sm font-semibold text-navy">{title}</h4>
      {children}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function FrequencySection({ title, rows }: { title: string; rows: FrequencyRow[] }) {
  return (
    <Section title={`Frequency and severity: ${title.toLowerCase()}`}>
      {rows.length ? (
        <Table
          head={[title.replace("By ", ""), "Claims", "Avg"]}
          numeric={[1, 2]}
          rows={rows.map((r) => [r.name, r.count, money(r.average)])}
        />
      ) : (
        <Muted>No claims in the period.</Muted>
      )}
    </Section>
  );
}

function ClaimTable({ rows }: { rows: ReportClaimRow[] }) {
  return (
    <Table
      head={["Claim #", "Date of loss", "Line", "Status", "Paid", "Reserve", "Incurred"]}
      numeric={[4, 5, 6]}
      rows={rows.map((r) => [
        claimNo(r),
        r.dateOfLoss ? formatDate(r.dateOfLoss) : "—",
        r.line,
        r.status,
        money(r.paid),
        money(r.reserve),
        money(r.incurred),
      ])}
    />
  );
}

function Table({
  head,
  rows,
  foot,
  numeric = [],
}: {
  head: string[];
  rows: (string | number)[][];
  foot?: (string | number)[];
  numeric?: number[];
}) {
  const align = (i: number) => (numeric.includes(i) ? "text-right whitespace-nowrap" : "text-left");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className={`p-2 ${align(i)}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-t border-border">
              {row.map((cell, i) => (
                <td key={i} className={`p-2 ${align(i)}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/20 font-semibold text-navy">
              {foot.map((cell, i) => (
                <td key={i} className={`p-2 ${align(i)}`}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
