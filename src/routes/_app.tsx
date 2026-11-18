import { useEffect, useState } from "react";
import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { toast } from "sonner";
import { endViewAsBeforeSignOut, useAuth } from "@/hooks/use-auth";
import { HOME_PATH } from "@/lib/navigation";
import { AppShell } from "@/components/app-shell";
import { SignatureOnFileDialog } from "@/components/signature-on-file-dialog";
import { supabase } from "@/integrations/supabase/client";
import { getSignInStep } from "@/lib/mfa-client";
import { IdleWarningDialog } from "@/components/idle-warning-dialog";
import {
  clearSessionTimes,
  EXPIRY_MESSAGE,
  idleWarningMsLeft,
  markActive,
  readSessionTimes,
  sessionExpiryReason,
} from "@/lib/session-expiry";

// Signs out if the session ran past its idle or total limit; true if it did.
async function endExpiredSession(): Promise<boolean> {
  const reason = sessionExpiryReason(readSessionTimes(), Date.now());
  if (!reason) return false;
  clearSessionTimes();
  await endViewAsBeforeSignOut();
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
    // Fix 51: a login that owes the second step (its code, or setting one up) goes back to /login.
    if ((await getSignInStep()) !== "done") throw redirect({ to: "/login" });
  },
  component: AppLayout,
});

// Records activity (throttled) and checks the limits once a minute and whenever
// the tab comes back into view.
function useSessionExpiry() {
  const navigate = useNavigate();
  // Fix 51: time left before the idle sign-out once it is within the warning window.
  const [warnMsLeft, setWarnMsLeft] = useState<number | null>(null);
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
    // Once a second: show or update the idle warning, and sign out the moment it runs out.
    // Reads the shared localStorage times, so activity in any tab clears it in all.
    const tick = setInterval(() => {
      const now = Date.now();
      setWarnMsLeft(idleWarningMsLeft(readSessionTimes(), now));
      if (sessionExpiryReason(readSessionTimes(), now)) void check();
    }, 1000);
    return () => {
      clearInterval(tick);
      for (const e of events) window.removeEventListener(e, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [navigate]);
  const stay = () => {
    markActive();
    setWarnMsLeft(null);
  };
  const signOutNow = async () => {
    clearSessionTimes();
    await endViewAsBeforeSignOut();
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };
  return { warnMsLeft, stay, signOutNow };
}

function AppLayout() {
  const { loading, user, role, viewingAs } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Viewing as a client (fix 55): agency pages aren't part of the client's portal.
  const onAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const leaveAdmin = !!viewingAs && onAdminPage;
  useEffect(() => {
    if (leaveAdmin) navigate({ to: HOME_PATH, replace: true });
  }, [leaveAdmin, navigate]);
  const idle = useSessionExpiry();
  if (loading || leaveAdmin) {
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
      <IdleWarningDialog msLeft={idle.warnMsLeft} onStay={idle.stay} onSignOut={idle.signOutNow} />
    </AppShell>
  );
}
