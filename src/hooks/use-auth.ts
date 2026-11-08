import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type AppRole = "agency_admin" | "client";

export interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  clientId: string | null;
}

const INITIAL_STATE: AuthState = {
  loading: true,
  session: null,
  user: null,
  role: null,
  clientId: null,
};

// What a session change means for the role/client lookup, given the user id it
// was last run for (undefined = not run yet). Token refreshes and repeat events
// for the same user keep the lookup they already have.
export type SessionChange = "same-user" | "signed-out" | "new-user";

export function classifySessionChange(
  loadedForUserId: string | null | undefined,
  nextUserId: string | null,
): SessionChange {
  if (loadedForUserId !== undefined && loadedForUserId === nextUserId) return "same-user";
  return nextUserId ? "new-user" : "signed-out";
}

async function loadRoleAndClient(user: User): Promise<Pick<AuthState, "role" | "clientId">> {
  const [{ data: roles }, { data: client }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase.from("clients").select("id").eq("user_id", user.id).maybeSingle(),
  ]);
  const isAdmin = roles?.some((r) => r.role === "agency_admin");
  return {
    role: isAdmin ? "agency_admin" : "client",
    clientId: client?.id ?? null,
  };
}

const AuthContext = createContext<AuthState | null>(null);

// Holds the session and resolves the user's role and client once per signed-in
// user, for every component that calls useAuth(). Mounted once in __root.tsx.
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    let loadedFor: string | null | undefined;

    // onAuthStateChange fires INITIAL_SESSION on subscribe, so this one listener
    // also covers the first load (no separate getSession call).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      const userId = user?.id ?? null;
      const change = classifySessionChange(loadedFor, userId);
      const switchedUser = loadedFor !== undefined && change !== "same-user";
      loadedFor = userId;

      if (change === "same-user") {
        setState((s) => ({ ...s, session, user }));
        return;
      }
      // Cached data belongs to the previous user; the query keys don't carry the user id.
      // Cleared after React has re-rendered with the new state, so the old user's pages
      // are already unmounted; clearing first makes them refetch once with no session (401).
      if (switchedUser) setTimeout(() => queryClient.removeQueries(), 0);

      if (change === "signed-out") {
        setState({ ...INITIAL_STATE, loading: false });
        return;
      }

      setState({ ...INITIAL_STATE, session, user });
      // Deferred out of the auth callback: Supabase calls made inside it can deadlock.
      setTimeout(async () => {
        const extras = await loadRoleAndClient(user!);
        if (cancelled || loadedFor !== userId) return;
        setState((s) => ({ ...s, loading: false, ...extras }));
      }, 0);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  return createElement(AuthContext.Provider, { value: state }, children);
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error("useAuth must be used inside <AuthProvider>");
  return state;
}
