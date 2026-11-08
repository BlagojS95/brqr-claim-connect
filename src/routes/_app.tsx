import { useEffect } from "react";
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/app-shell";
import { SignatureOnFileDialog } from "@/components/signature-on-file-dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  clearSessionTimes,
  EXPIRY_MESSAGE,
  markActive,
  readSessionTimes,
  sessionExpiryReason,
} from "@/lib/session-expiry";

// Signs out if the session ran past its idle or total limit; true if it did.
async function endExpiredSession(): Promise<boolean> {
  const reason = sessionExpiryReason(readSessionTimes(), Date.now());
  if (!reason) return false;
  clearSessionTimes();
  await supabase.auth.signOut();
  toast.info(EXPIRY_MESSAGE[reason]);
  return true;
}

export const Route = createFileRoute("/_app")({
  // The session lives in the browser, so the server would always redirect to /login
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    // Checked before any page renders, so an expired session never shows data.
    if (!data.session || (await endExpiredSession())) {
      throw redirect({ to: "/login" });
    }
  },
  component: AppLayout,
});

// Records activity (throttled) and checks the limits once a minute and whenever
// the tab comes back into view.
function useSessionExpiry() {
  const navigate = useNavigate();
  useEffect(() => {
    let lastMark = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastMark < 15_000) return;
      lastMark = now;
      markActive(now);
    };
    const check = async () => {
      if (await endExpiredSession()) navigate({ to: "/login" });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, 60_000);
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [navigate]);
}

function AppLayout() {
  const { loading, user, role } = useAuth();
  useSessionExpiry();
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
