// "Your claims advocate" (fix 59): who to call at the agency, shown in the
// desktop sidebar footer and, on a phone, in a Help sheet opened from the
// top-right Menu. Only for client logins (and agency staff viewing as a
// client); hidden when nothing has been set up.
import { Clock, Mail, Phone, UserRound } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { telHref, type ClaimsAdvocateInfo } from "@/lib/claims-advocate";
import { cn } from "@/lib/utils";

/**
 * The contact lines. `tone` "sidebar" is light text on navy; "sheet" is the
 * normal page colours.
 */
export function ClaimsAdvocateBlock({
  info,
  tone,
  className,
}: {
  info: ClaimsAdvocateInfo;
  tone: "sidebar" | "sheet";
  className?: string;
}) {
  const a = info.advocate;
  const sidebar = tone === "sidebar";
  const muted = sidebar ? "text-sidebar-foreground/70" : "text-muted-foreground";
  const link = cn(
    "flex items-center gap-2 rounded-sm min-w-0 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2",
    sidebar ? "focus-visible:ring-gold" : "focus-visible:ring-ring text-navy",
  );
  const icon = cn("h-4 w-4 shrink-0", sidebar ? "text-gold" : "text-navy");

  return (
    <section aria-label="Your claims advocate" className={cn("space-y-2 text-sm", className)}>
      {a && (
        <>
          <h2 className={cn("text-xs font-semibold uppercase tracking-wide", muted)}>
            Your claims advocate
          </h2>
          {a.name && (
            <p className="flex items-center gap-2 font-medium min-w-0">
              <UserRound className={icon} aria-hidden />
              <span className="truncate">{a.name}</span>
            </p>
          )}
          {a.phone && (
            <a href={telHref(a.phone)} className={link} aria-label={`Call ${a.phone}`}>
              <Phone className={icon} aria-hidden />
              <span className="truncate">{a.phone}</span>
            </a>
          )}
          {a.email && (
            <a href={`mailto:${a.email}`} className={link} aria-label={`Email ${a.email}`}>
              <Mail className={icon} aria-hidden />
              <span className="truncate">{a.email}</span>
            </a>
          )}
        </>
      )}
      {info.afterHoursPhone && (
        <div className={cn(a && "pt-1")}>
          <p className={cn("text-xs", muted)}>After hours, call our claims line</p>
          <a
            href={telHref(info.afterHoursPhone)}
            className={link}
            aria-label={`Call the after-hours claims line ${info.afterHoursPhone}`}
          >
            <Clock className={icon} aria-hidden />
            <span className="truncate">{info.afterHoursPhone}</span>
          </a>
        </div>
      )}
    </section>
  );
}

/** The phone Help sheet; opened from the Menu. */
export function ClaimsAdvocateSheet({
  info,
  open,
  onOpenChange,
}: {
  info: ClaimsAdvocateInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-navy">Help</SheetTitle>
          <SheetDescription>Questions about a claim? Contact us directly.</SheetDescription>
        </SheetHeader>
        <ClaimsAdvocateBlock info={info} tone="sheet" className="mt-4 text-base" />
      </SheetContent>
    </Sheet>
  );
}
