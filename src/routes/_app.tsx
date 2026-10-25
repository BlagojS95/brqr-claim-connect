import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/app-shell";
import { SignatureOnFileDialog } from "@/components/signature-on-file-dialog";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app")({
  // The session lives in the browser, so the server would always redirect to /login
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login" });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const { loading, user, role } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }
  if (!user) return null;
  return (
    <AppShell role={role}>
      <Outlet />
      <SignatureOnFileDialog />
    </AppShell>
  );
}
