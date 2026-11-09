// Draws the renewal pack PDF (fix 36) from sections built by src/lib/renewal-pack.ts.
// Only imported (with import()) when the user clicks "Download renewal pack".

import { incurredAmount, paidAmount, reserveAmount } from "@/lib/claim-metrics";
import { CLAIM_STATUS_LABELS } from "@/lib/claim-status";
import { formatDate } from "@/lib/dates";
import { exportFileName } from "@/lib/exports/table";
import {
  PDF_GOLD,
  PDF_MARGIN,
  PDF_MUTED,
  PDF_NAVY,
  PDF_TOP,
  createPdfReport,
  pdfMoney,
} from "@/lib/exports/pdf";
import { formatLossRatio, type RenewalSection, type RenewalYear } from "@/lib/renewal-pack";

const DEVELOPING = "still developing";

const yearLabel = (y: RenewalYear) => (y.developing ? `${y.year} (${DEVELOPING})` : String(y.year));
const premiumText = (premium: number | null) => (premium === null ? "—" : pdfMoney(premium));
const modText = (mods: number[]) => (mods.length ? mods.map((m) => m.toFixed(2)).join(" / ") : "—");

const RIGHT = { halign: "right" as const };

export async function downloadRenewalPackPdf(
  sections: RenewalSection[],
  { today, client }: { today: string; client?: string },
): Promise<void> {
  const valuedAs = `Valued as of ${formatDate(today)}`;
  const report = await createPdfReport({ title: "Renewal Pack", valuedAs, subtitle: client });
  const { doc } = report;

  const text = (
    value: string,
    y: number,
    {
      size = 10,
      bold = false,
      color = PDF_NAVY,
    }: { size?: number; bold?: boolean; color?: [number, number, number] } = {},
  ) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(value, report.pageWidth - PDF_MARGIN * 2) as string[];
    doc.text(lines, PDF_MARGIN, y);
    return y + lines.length * size * 1.25;
  };

  // Cover: what is in the pack, with one line per line of business.
  let y = text("Renewal loss history", PDF_TOP + 14, { size: 18, bold: true });
  if (client) y = text(client, y + 2, { size: 12 });
  y = text(
    `Five policy years per line of business. ${valuedAs}; figures for the current policy year are ${DEVELOPING}.`,
    y + 6,
    { size: 9, color: PDF_MUTED },
  );
  report.autoTable({
    startY: y + 8,
    head: [["Line of business", "Policy years", "Claims", "Incurred", "Premium", "Loss ratio"]],
    body: sections.map((s) => [
      s.line,
      `${s.years.at(-1)?.year}–${s.years[0]?.year}`,
      String(s.totals.claims),
      pdfMoney(s.totals.incurred),
      premiumText(s.totals.premium),
      formatLossRatio(s.totals.lossRatio),
    ]),
    columnStyles: { 2: RIGHT, 3: RIGHT, 4: RIGHT, 5: RIGHT },
  });
  y = text(
    "Claims are attributed to the policy year of the policy whose term contains the date of loss, " +
      "or to the calendar year of the loss when no such policy is on file. Loss ratio is incurred " +
      "(paid plus reserve) divided by written premium; it shows — where no premium is stored, and " +
      "the total counts only years with premium.",
    report.lastY() + 18,
    { size: 8, color: PDF_MUTED },
  );

  for (const section of sections) {
    doc.addPage();
    y = text(section.line, PDF_TOP + 14, { size: 15, bold: true });
    doc.setFillColor(...PDF_GOLD);
    doc.rect(PDF_MARGIN, y - 8, 60, 2, "F");
    y = text(`Policy years ${section.years.at(-1)?.year}–${section.years[0]?.year}`, y + 6, {
      size: 9,
      color: PDF_MUTED,
    });

    const showMod = section.isWorkersComp && section.hasExperienceMods;
    const head = ["Policy year", "Claims", "Paid", "Reserve", "Incurred", "Premium", "Loss ratio"];
    if (showMod) head.push("Exp. mod");
    const body = section.years.map((yr) => {
      const row = [
        yearLabel(yr),
        String(yr.claims),
        pdfMoney(yr.paid),
        pdfMoney(yr.reserve),
        pdfMoney(yr.incurred),
        premiumText(yr.premium),
        formatLossRatio(yr.lossRatio),
      ];
      if (showMod) row.push(modText(yr.experienceMods));
      return row;
    });
    const t = section.totals;
    const foot = [
      "Total",
      String(t.claims),
      pdfMoney(t.paid),
      pdfMoney(t.reserve),
      pdfMoney(t.incurred),
      premiumText(t.premium),
      formatLossRatio(t.lossRatio),
    ];
    if (showMod) foot.push("");
    report.autoTable({
      startY: y + 6,
      head: [head],
      body,
      foot: [foot],
      showFoot: "lastPage",
      columnStyles: { 1: RIGHT, 2: RIGHT, 3: RIGHT, 4: RIGHT, 5: RIGHT, 6: RIGHT, 7: RIGHT },
      didParseCell: (data) => {
        // The current year in italics, so "still developing" stands out.
        if (data.section === "body" && section.years[data.row.index]?.developing) {
          data.cell.styles.fontStyle = "italic";
        }
      },
    });

    y = report.ensureSpace(report.lastY() + 26, 60);
    y = text(`Claims (${section.claims.length})`, y, { size: 11, bold: true });
    if (section.claims.length === 0) {
      text("No claims in these policy years.", y + 2, { size: 9, color: PDF_MUTED });
      continue;
    }
    report.autoTable({
      startY: y,
      head: [
        [
          "Policy year",
          "Claim #",
          "Date of loss",
          "Claimant",
          "Type",
          "Status",
          "Paid",
          "Reserve",
          "Incurred",
        ],
      ],
      body: section.claims.map(({ claim: c, policyYear }) => [
        String(policyYear),
        c.claim_number?.trim() || "Number pending",
        formatDate(c.date_of_loss),
        c.claimant_name?.trim() || "—",
        c.claim_type,
        CLAIM_STATUS_LABELS[c.status],
        pdfMoney(paidAmount(c)),
        pdfMoney(reserveAmount(c)),
        pdfMoney(incurredAmount(c)),
      ]),
      styles: { fontSize: 7.5, cellPadding: 3 },
      columnStyles: { 6: RIGHT, 7: RIGHT, 8: RIGHT },
    });
  }

  report.save(exportFileName("renewal-pack", today, "pdf"));
}
