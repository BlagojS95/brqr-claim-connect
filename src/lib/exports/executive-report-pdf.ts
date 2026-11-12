// The executive loss report PDF (fix 46). Rendered on the server from an
// ExecutiveReport, so the download, a shared link's download and the monthly
// email attachment are the same file.

import { formatDate } from "@/lib/dates";
import {
  WC_CLAIM_KIND_LABELS,
  type ExecutiveReport,
  type FrequencyRow,
  type ReportClaimRow,
} from "@/lib/executive-report";
import { formatLossRatio } from "@/lib/renewal-pack";
import {
  createPdfReport,
  pdfMoney,
  PDF_MARGIN,
  PDF_MUTED,
  PDF_NAVY,
  PDF_TOP,
} from "@/lib/exports/pdf";

export const EXECUTIVE_REPORT_TITLE = "Executive Loss Report";

const pct = (n: number | null) =>
  n === null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;
const range = (r: { from: string; to: string }) => `${formatDate(r.from)} – ${formatDate(r.to)}`;
const claimNo = (r: ReportClaimRow) => r.claimNumber?.trim() || "Pending";

export function executiveReportFileName(report: ExecutiveReport): string {
  const slug = report.clientName
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `executive-loss-report-${slug || "client"}-${report.period.from}-to-${report.period.to}.pdf`;
}

export async function renderExecutiveReportPdf(report: ExecutiveReport): Promise<ArrayBuffer> {
  const pdf = await createPdfReport({
    title: EXECUTIVE_REPORT_TITLE,
    valuedAs: `Valued as of ${formatDate(report.valuedAsOf)}`,
    subtitle: report.clientName,
  });
  const { doc } = pdf;
  let y = PDF_TOP + 6;

  const heading = (text: string, needed = 90) => {
    y = pdf.ensureSpace(y + 18, needed);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...PDF_NAVY);
    doc.text(text, PDF_MARGIN, y);
    y += 8;
  };
  const note = (text: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_MUTED);
    const lines = doc.splitTextToSize(text, pdf.pageWidth - PDF_MARGIN * 2) as string[];
    y = pdf.ensureSpace(y + 4, lines.length * 11 + 4);
    doc.text(lines, PDF_MARGIN, y + 8);
    y += lines.length * 11 + 4;
  };
  const table = (head: string[], body: string[][], money: number[] = [], foot?: string[]) => {
    pdf.autoTable({
      startY: y + 4,
      head: [head],
      body,
      foot: foot ? [foot] : undefined,
      showFoot: "lastPage",
      columnStyles: Object.fromEntries(money.map((i) => [i, { halign: "right" as const }])),
    });
    y = pdf.lastY();
  };
  const claimRows = (rows: ReportClaimRow[]) =>
    rows.map((r) => [
      claimNo(r),
      r.dateOfLoss ? formatDate(r.dateOfLoss) : "—",
      r.line,
      r.status,
      pdfMoney(r.paid),
      pdfMoney(r.reserve),
      pdfMoney(r.incurred),
    ]);
  const CLAIM_HEAD = ["Claim #", "Date of loss", "Line", "Status", "Paid", "Reserve", "Incurred"];
  const CLAIM_MONEY = [4, 5, 6];

  // Period line
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text(
    `Period: ${range(report.period)}   ·   Compared with: ${range(report.comparison)}`,
    PDF_MARGIN,
    y + 4,
  );
  y += 10;

  // 1. Headline
  heading("Headline");
  const h = report.headline;
  table(
    ["", "This period", "Comparison", "Change"],
    [
      ["New claims", String(h.current.claims), String(h.comparison.claims), pct(h.change.claims)],
      ["Open (today)", String(h.current.open), String(h.comparison.open), pct(h.change.open)],
      [
        "Closed (today)",
        String(h.current.closed),
        String(h.comparison.closed),
        pct(h.change.closed),
      ],
      ["Paid", pdfMoney(h.current.paid), pdfMoney(h.comparison.paid), pct(h.change.paid)],
      [
        "Reserve",
        pdfMoney(h.current.reserve),
        pdfMoney(h.comparison.reserve),
        pct(h.change.reserve),
      ],
      [
        "Incurred",
        pdfMoney(h.current.incurred),
        pdfMoney(h.comparison.incurred),
        pct(h.change.incurred),
      ],
    ],
    [1, 2, 3],
  );
  note("Claims are counted by date of loss. Open and closed show each claim's status today.");

  // 2. Loss ratio by line
  heading("Loss ratio by line of business");
  const lr = report.lossRatio;
  const lrRow = (r: typeof lr.total) => [
    r.line,
    String(r.claims),
    pdfMoney(r.incurred),
    r.earnedPremium === null ? "—" : pdfMoney(r.earnedPremium),
    formatLossRatio(r.ratio),
  ];
  table(
    ["Line", "Claims", "Incurred", "Earned premium", "Loss ratio"],
    lr.rows.map(lrRow),
    [1, 2, 3, 4],
    lrRow(lr.total),
  );
  note(
    "Earned premium is each policy's premium pro rata for the days of its term inside the period.",
  );

  // 3. Large losses
  heading(`Large losses (incurred ${pdfMoney(report.threshold)} or more)`);
  if (report.largeLosses.length) table(CLAIM_HEAD, claimRows(report.largeLosses), CLAIM_MONEY);
  else note("No claims in the period reached the threshold.");

  // 4. Open-claim aging
  heading("Open-claim aging");
  table(
    ["Age (since reported)", "Open claims", "Incurred"],
    report.aging.buckets.map((b) => [b.label, String(b.count), pdfMoney(b.incurred)]),
    [1, 2],
  );
  if (report.aging.oldest.length) {
    note("Oldest open claims:");
    table(
      ["Claim #", "Date of loss", "Line", "Days open", "Incurred"],
      report.aging.oldest.map((r) => [
        claimNo(r),
        r.dateOfLoss ? formatDate(r.dateOfLoss) : "—",
        r.line,
        String(r.ageDays),
        pdfMoney(r.incurred),
      ]),
      [3, 4],
    );
  }
  note(`All ${report.aging.open} claims open today, whatever their date of loss.`);

  // 5. Reserve changes
  heading("Largest reserve changes in the period");
  if (report.reserveChanges.rows.length) {
    table(
      ["Claim #", "Line", "Reserve before", "Reserve after", "Change"],
      report.reserveChanges.rows.map((r) => [
        claimNo(r),
        r.line,
        pdfMoney(r.from),
        pdfMoney(r.to),
        `${r.change > 0 ? "+" : "−"}${pdfMoney(Math.abs(r.change))}`,
      ]),
      [2, 3, 4],
    );
  } else {
    note("No reserve changes recorded in the period.");
  }
  note(
    report.reserveChanges.historySince
      ? `Reserve changes are recorded from ${formatDate(report.reserveChanges.historySince.slice(0, 10))}.`
      : "Reserve changes are recorded from the day this report was introduced.",
  );

  // 6. Frequency and severity
  const fsTable = (title: string, rows: FrequencyRow[]) => {
    heading(`Frequency and severity by ${title}`, 70);
    if (!rows.length) return note("No claims in the period.");
    table(
      [title[0].toUpperCase() + title.slice(1), "Claims", "Incurred", "Average per claim"],
      rows.map((r) => [r.name, String(r.count), pdfMoney(r.incurred), pdfMoney(r.average)]),
      [1, 2, 3],
    );
  };
  fsTable("cause", report.frequencySeverity.cause);
  fsTable("location", report.frequencySeverity.location);
  fsTable("line", report.frequencySeverity.line);

  // 7. Workers comp
  const wc = report.workersComp;
  heading("Workers compensation");
  if (wc.claims) {
    table(
      ["", "Claims", "Incurred"],
      [
        [WC_CLAIM_KIND_LABELS.lost_time, String(wc.lostTime.count), pdfMoney(wc.lostTime.incurred)],
        [
          WC_CLAIM_KIND_LABELS.medical_only,
          String(wc.medicalOnly.count),
          pdfMoney(wc.medicalOnly.incurred),
        ],
        ["Not recorded", String(wc.notRecorded.count), pdfMoney(wc.notRecorded.incurred)],
      ],
      [1, 2],
    );
  } else {
    note("No workers compensation claims in the period.");
  }
  if (wc.experienceMods.length) {
    table(
      ["Policy", "Term", "Experience mod"],
      wc.experienceMods.map((m) => [m.policyNumber, m.term, m.mod.toFixed(2)]),
      [2],
    );
  }

  // 8. Litigation and recoveries
  heading("Litigated claims and recoveries");
  const lit = report.litigation;
  const rec = report.recoveries;
  table(
    ["", "Claims", "Amount"],
    [
      ["Litigated claims (incurred)", String(lit.count), pdfMoney(lit.incurred)],
      ["Recoveries (subrogation, salvage)", String(rec.claims), pdfMoney(rec.total)],
      ["Net incurred after recoveries", "", pdfMoney(rec.netIncurred)],
    ],
    [1, 2],
  );
  if (lit.claims.length) table(CLAIM_HEAD, claimRows(lit.claims), CLAIM_MONEY);

  // 9. Broker notes
  heading("Broker notes", 60);
  note(report.brokerNotes ?? "None.");

  return pdf.toArrayBuffer();
}
