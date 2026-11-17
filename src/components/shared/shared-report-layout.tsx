import type { ReactNode } from "react";
import { formatDate } from "@/lib/dates";
import claimsQrLogoWhite from "@/assets/claims-qr-logo-white.png";

// The minimal branded frame for a shared report link (fix 57): the ClaimsQR
// logo, the report's title, client, valuation date and expiry, and nothing
// else. No navigation, no account menu, no links into the portal.

/** "Nov 17, 2026" from an expiry timestamp (expires_at is a timestamptz). */
export function formatExpiry(expiresAt: string): string {
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { dateStyle: "medium" });
}

export function SharedReportFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy text-navy-foreground">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between gap-3">
          <img src={claimsQrLogoWhite} alt="ClaimsQR" className="h-8 w-auto" />
          <span className="text-xs text-white/70">Read-only shared report</span>
        </div>
        <div className="h-1 bg-gold" />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">{children}</main>
    </div>
  );
}

/**
 * Title block for a shared report. `actions` is the download button(s);
 * `detail` is an optional extra line such as the Loss Summary's filters.
 */
export function SharedReportHeader({
  title,
  clientName,
  valuedAsOf,
  expiresAt,
  detail,
  actions,
}: {
  title: string;
  clientName: string;
  /** "YYYY-MM-DD" calendar date. */
  valuedAsOf: string;
  expiresAt: string;
  detail?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl md:text-3xl font-bold text-navy break-words">{title}</h1>
        <p className="text-base font-medium text-navy break-words">{clientName}</p>
        {detail && <p className="text-sm text-muted-foreground break-words">{detail}</p>}
        <p className="text-sm text-muted-foreground">Valued as of {formatDate(valuedAsOf)}</p>
        <p className="text-sm text-muted-foreground">
          This link expires on {formatExpiry(expiresAt)}
        </p>
      </div>
      {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function SharedReportFooter() {
  return (
    <p className="text-xs text-muted-foreground">
      Prepared by BRQR Insurance Agency with ClaimsQR. Figures are as of the valuation date and may
      have changed since.
    </p>
  );
}
