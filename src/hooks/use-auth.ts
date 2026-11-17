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
import { CLIENT_USER_ROLE, type ClientUserRole } from "@/lib/client-users";
import { endViewAsClient, fetchViewAsSession } from "@/lib/view-as.functions";
import type { ViewingAs } from "@/lib/view-as";

export type AppRole = "agency_admin" | "client";

export interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  clientId: string | null;
  /** The client user's access within their company (fix 32); null for agency staff. */
  clientRole: ClientUserRole | null;
  /** A location user's locations; empty for everyone else. */
  locationIds: string[];
  /**
   * Set while an agency admin views a client's portal (fix 55). The UI then
   * renders as that client's admin login (role "client", clientRole
   * client_admin). Only for display: the server and the database keep the
   * session and block every write.
   */
  viewingAs: ViewingAs | null;
}

const INITIAL_STATE: AuthState = {
  loading: true,
  session: null,
  user: null,
  role: null,
  clientId: null,
  clientRole: null,
  locationIds: [],
  viewingAs: null,
};

// Read by the sign-out paths, which run outside React (see endViewAsOnSignOut).
let viewingAsNow: ViewingAs | null = null;
export function currentViewingAs(): ViewingAs | null {
  return viewingAsNow;
}

/** Call before supabase.auth.signOut(): ends an open view-as session (fix 55). */
export async function endViewAsBeforeSignOut(): Promise<void> {
  if (!viewingAsNow) return;
  try {
    await endViewAsClient({ data: { reason: "sign_out" } });
  } catch {
    // Signing out goes ahead; the session runs out on its own after 8 hours.
  }
  viewingAsNow = null;
}

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

// Only used to choose what the UI shows; the server and RLS check access again.
async function loadRoleAndClient(
  user: User,
): Promise<Pick<AuthState, "role" | "clientId" | "clientRole" | "locationIds" | "viewingAs">> {
  const [{ data: roles }, { data: member }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    // Every login of a company has a client_users row (fix 32).
    supabase
      .from("client_users")
      .select("client_id, role, location_ids")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  const isAdmin = roles?.some((r) => r.role === "agency_admin");
  // An admin in a view-as-client session sees that client's portal (fix 55).
  // If the check fails the admin UI shows, and the server still blocks writes.
  const viewingAs = isAdmin ? await fetchViewAsSession().catch(() => null) : null;
  if (viewingAs) {
    return {
      role: "client",
      clientId: viewingAs.clientId,
      clientRole: CLIENT_USER_ROLE.clientAdmin,
      locationIds: [],
      viewingAs,
    };
  }
  return {
    role: isAdmin ? "agency_admin" : "client",
    clientId: member?.client_id ?? null,
    clientRole: isAdmin ? null : (member?.role ?? null),
    locationIds: member?.location_ids ?? [],
    viewingAs: null,
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
        viewingAsNow = null;
        setState({ ...INITIAL_STATE, loading: false });
        return;
      }

      setState({ ...INITIAL_STATE, session, user });
      // Deferred out of the auth callback: Supabase calls made inside it can deadlock.
      setTimeout(async () => {
        const extras = await loadRoleAndClient(user!);
        if (cancelled || loadedFor !== userId) return;
        viewingAsNow = extras.viewingAs;
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
