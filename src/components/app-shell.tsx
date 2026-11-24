import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Home,
  FileText,
  PlusCircle,
  Bell,
  Users,
  LogOut,
  Shield,
  FolderArchive,
  FileBarChart,
  LineChart,
  Settings,
  ListChecks,
} from "lucide-react";
import { CLIENT_USER_ROLE } from "@/lib/client-users";
import claimsQrLogo from "@/assets/claims-qr-logo-white.png";
import { supabase } from "@/integrations/supabase/client";
import { clearSessionTimes } from "@/lib/session-expiry";
import { cn } from "@/lib/utils";
import { activeNavPath, HOME_PATH, LOSS_RUNS_PATH, STAFF_QUEUE_PATH } from "@/lib/navigation";
import {
  INCIDENT_NOTICE_PATH,
  MobileBottomNav,
  MobileMenu,
  REPORT_NEW_CLAIM_PATH,
} from "@/components/mobile-nav";
import { endViewAsBeforeSignOut, useAuth, type AppRole } from "@/hooks/use-auth";
import { ViewAsBanner } from "@/components/staff/view-as";
import { ClaimsAdvocateBlock, ClaimsAdvocateSheet } from "@/components/help/claims-advocate";
import { useClaimsAdvocate } from "@/hooks/use-claims-advocate";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  adminOnly?: boolean;
  /** Company-wide pages; hidden for location users (fix 32). */
  companyOnly?: boolean;
}

const items: NavItem[] = [
  { to: HOME_PATH, label: "Home", icon: Home },
  // Agency staff land here after signing in (fix 52).
  { to: STAFF_QUEUE_PATH, label: "Work Queue", icon: ListChecks, adminOnly: true },
  { to: "/claims", label: "Claims", icon: FileText },
  { to: REPORT_NEW_CLAIM_PATH, label: "Report New Claim", icon: PlusCircle },
  { to: INCIDENT_NOTICE_PATH, label: "Incident Notice Only", icon: Bell },
  { to: "/policies", label: "Policies", icon: Shield },
  { to: "/insights", label: "Insights", icon: LineChart },
  { to: "/reports", label: "Reports", icon: FileBarChart },
  { to: LOSS_RUNS_PATH, label: "Loss Runs", icon: FolderArchive, companyOnly: true },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/admin", label: "Admin", icon: Users, adminOnly: true },
];

export function AppShell({ children, role }: { children: React.ReactNode; role: AppRole | null }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { viewingAs, clientRole } = useAuth();
  const companyUser = clientRole !== CLIENT_USER_ROLE.location;
  // Client logins only (and staff viewing as a client); null otherwise (fix 59).
  const advocate = useClaimsAdvocate();
  const [helpOpen, setHelpOpen] = useState(false);
  const visible = items.filter(
    (i) => (!i.adminOnly || role === "agency_admin") && (!i.companyOnly || companyUser),
  );
  const activePath = activeNavPath(
    pathname,
    visible.map((i) => i.to),
  );

  const logout = async () => {
    clearSessionTimes();
    await endViewAsBeforeSignOut();
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className={cn("min-h-screen flex bg-background", viewingAs && "pt-11")}>
      {/* Fixed at the top of every page while viewing as a client (fix 55). */}
      {viewingAs && <ViewAsBanner viewingAs={viewingAs} />}
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground">
        <div className="p-6 border-b border-sidebar-border">
          <img src={claimsQrLogo} alt="ClaimsQR" className="h-11 w-auto" />
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {visible.map((item) => {
            const active = item.to === activePath;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-gold"
                    : "hover:bg-sidebar-accent/60 text-sidebar-foreground/85",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
        {advocate && (
          <ClaimsAdvocateBlock
            info={advocate}
            tone="sidebar"
            className="mx-3 px-3 py-3 border-t border-sidebar-border"
          />
        )}
        <button
          onClick={logout}
          className="m-3 flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-sidebar-accent/60"
        >
          <LogOut className="h-4 w-4" aria-hidden /> Sign out
        </button>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between p-4 bg-navy text-navy-foreground">
          <img src={claimsQrLogo} alt="ClaimsQR" className="h-8 w-auto" />
          {/* Every sidebar page and Sign out; the bottom bar holds the main five. */}
          <MobileMenu
            items={visible}
            activePath={activePath}
            onSignOut={logout}
            onHelp={advocate ? () => setHelpOpen(true) : undefined}
          />
          {advocate && (
            <ClaimsAdvocateSheet info={advocate} open={helpOpen} onOpenChange={setHelpOpen} />
          )}
        </header>
        <div className="flex-1 p-4 md:p-8 pb-24 md:pb-8 overflow-y-auto">{children}</div>

        {/* Mobile bottom nav (fix 23) */}
        <MobileBottomNav activePath={activePath} showLossRuns={companyUser} />
      </main>
    </div>
  );
}
