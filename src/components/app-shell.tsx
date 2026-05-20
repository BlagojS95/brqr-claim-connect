import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Home, FileText, PlusCircle, Bell, Users, LogOut } from "lucide-react";
import brqrLogo from "@/assets/brqr-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/hooks/use-auth";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  adminOnly?: boolean;
}

const items: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: Home },
  { to: "/claims", label: "Claims", icon: FileText },
  { to: "/claims/new", label: "Report Claim", icon: PlusCircle },
  { to: "/claims/notice", label: "Notice of Claim", icon: Bell },
  { to: "/admin", label: "Admin", icon: Users, adminOnly: true },
];

export function AppShell({ children, role }: { children: React.ReactNode; role: AppRole | null }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const visible = items.filter((i) => !i.adminOnly || role === "agency_admin");

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground">
        <div className="p-6 border-b border-sidebar-border flex items-center gap-3">
          <img src={brqrLogo} alt="BRQR" className="h-10 w-10 rounded-md" />
          <div>
            <div className="font-bold text-base leading-tight">BRQR</div>
            <div className="text-xs text-sidebar-foreground/70">Claims Portal</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {visible.map((item) => {
            const active = pathname === item.to || (item.to !== "/dashboard" && pathname.startsWith(item.to));
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-gold"
                    : "hover:bg-sidebar-accent/60 text-sidebar-foreground/85"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={logout}
          className="m-3 flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-sidebar-accent/60"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between p-4 bg-navy text-navy-foreground">
          <div className="flex items-center gap-2">
            <img src={brqrLogo} alt="BRQR" className="h-7 w-7 rounded" />
            <span className="font-bold">BRQR Claims</span>
          </div>
          <button onClick={logout} className="text-sm opacity-90">
            <LogOut className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 p-4 md:p-8 pb-24 md:pb-8 overflow-y-auto">{children}</div>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 bg-sidebar text-sidebar-foreground border-t border-sidebar-border flex">
          {visible.slice(0, 5).map((item) => {
            const active = pathname === item.to || (item.to !== "/dashboard" && pathname.startsWith(item.to));
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex-1 flex flex-col items-center py-2 text-[10px] gap-1",
                  active ? "text-gold" : "text-sidebar-foreground/70"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </main>
    </div>
  );
}
