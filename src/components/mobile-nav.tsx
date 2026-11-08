import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Bell, ChevronRight, FileText, FolderArchive, Home, Plus, Shield } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { HOME_PATH } from "@/lib/navigation";
import { cn } from "@/lib/utils";

// The mobile bottom bar (fix 23): Home, Claims, a raised Report button,
// Policies and Reports. Report opens a sheet with the two ways to report, so
// either form is one tap plus one choice from any page.

export const REPORT_NEW_CLAIM_PATH = "/claims/new";
export const INCIDENT_NOTICE_PATH = "/claims/notice";

const REPORT_PATHS: readonly string[] = [REPORT_NEW_CLAIM_PATH, INCIDENT_NOTICE_PATH];

const REPORT_CHOICES = [
  {
    to: REPORT_NEW_CLAIM_PATH,
    label: "Report New Claim",
    hint: "Submit a First Notice of Loss to begin the claim process.",
    icon: Plus,
  },
  {
    to: INCIDENT_NOTICE_PATH,
    label: "Incident Notice Only",
    hint: "Submit a notice for an incident that may result in a future claim.",
    icon: Bell,
  },
] as const;

const LEFT_ITEMS = [
  { to: HOME_PATH, label: "Home", icon: Home },
  { to: "/claims", label: "Claims", icon: FileText },
] as const;

const RIGHT_ITEMS = [
  { to: "/policies", label: "Policies", icon: Shield },
  { to: "/reports", label: "Reports", icon: FolderArchive },
] as const;

type BarItem = (typeof LEFT_ITEMS)[number] | (typeof RIGHT_ITEMS)[number];

/** `activePath` is the one highlighted nav path from activeNavPath. */
export function MobileBottomNav({ activePath }: { activePath: string | null }) {
  const [reportOpen, setReportOpen] = useState(false);
  const reportActive = activePath !== null && REPORT_PATHS.includes(activePath);

  const barLink = (item: BarItem) => {
    const active = item.to === activePath;
    const Icon = item.icon;
    return (
      <Link
        key={item.to}
        to={item.to}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex-1 min-w-0 flex flex-col items-center py-2 text-[10px] gap-1",
          active ? "text-gold" : "text-sidebar-foreground/70",
        )}
      >
        <Icon className="h-5 w-5" />
        {item.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-sidebar text-sidebar-foreground border-t border-sidebar-border flex items-end pb-[env(safe-area-inset-bottom)]"
    >
      {LEFT_ITEMS.map(barLink)}

      <Sheet open={reportOpen} onOpenChange={setReportOpen}>
        <SheetTrigger
          className={cn(
            "flex-1 min-w-0 flex flex-col items-center pb-2 text-[10px] gap-1 focus-visible:outline-none group",
            reportActive ? "text-gold" : "text-sidebar-foreground/70",
          )}
        >
          <span
            className={cn(
              "-mt-5 h-12 w-12 rounded-full flex items-center justify-center shadow-lg ring-4 ring-sidebar bg-gold text-gold-foreground group-focus-visible:ring-ring",
              reportActive && "ring-gold/40",
            )}
          >
            <Plus className="h-6 w-6" />
          </span>
          Report
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="rounded-t-xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="text-navy">Report</SheetTitle>
            <SheetDescription>What would you like to report?</SheetDescription>
          </SheetHeader>
          <ul className="mt-4 space-y-2">
            {REPORT_CHOICES.map((choice) => {
              const Icon = choice.icon;
              const active = choice.to === activePath;
              return (
                <li key={choice.to}>
                  <Link
                    to={choice.to}
                    onClick={() => setReportOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-4 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "border-gold bg-gold/10" : "border-border",
                    )}
                  >
                    <span className="h-10 w-10 shrink-0 rounded-full bg-navy text-navy-foreground flex items-center justify-center">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-navy">{choice.label}</span>
                      <span className="block text-sm text-muted-foreground">{choice.hint}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>

      {RIGHT_ITEMS.map(barLink)}
    </nav>
  );
}
