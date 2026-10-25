// Subject and body for the mailto links on the claim contacts table.
// Format agreed with the agency: "RE: Claim # 12345 | DOL 10/13/2026 | Jane Doe"

export interface ClaimEmailInfo {
  claimNumber: string | null;
  dateOfLoss: string | null;
  claimantName: string | null;
}

// date_of_loss is a plain "YYYY-MM-DD" date; formatting it by hand avoids the
// timezone shift new Date() would add.
function usDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return y && m && d ? `${m}/${d}/${y}` : isoDate;
}

export function claimEmailSubject({
  claimNumber,
  dateOfLoss,
  claimantName,
}: ClaimEmailInfo): string {
  const parts = [`RE: Claim # ${claimNumber ?? "pending"}`];
  if (dateOfLoss) parts.push(`DOL ${usDate(dateOfLoss)}`);
  if (claimantName) parts.push(claimantName);
  return parts.join(" | ");
}

export function followUpEmailBody(contactPerson: string | null): string {
  const greeting = contactPerson ? `Hello ${contactPerson},` : "Hello,";
  return [
    greeting,
    "",
    "We would like to follow up on the subject claim. Can you please let us know if there has been any movement, what the expected next steps are, and any timeline?",
    // Outlook only honours CRLF line breaks in a mailto body
  ].join("\r\n");
}
