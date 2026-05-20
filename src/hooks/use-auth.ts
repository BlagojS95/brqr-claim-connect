import { useEffect, useState } from "react";
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

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    loading: true,
    session: null,
    user: null,
    role: null,
    clientId: null,
  });

  useEffect(() => {
    let cancelled = false;

    const loadExtras = async (user: User | null) => {
      if (!user) return { role: null, clientId: null };
      const [{ data: roles }, { data: client }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("clients").select("id").eq("user_id", user.id).maybeSingle(),
      ]);
      const isAdmin = roles?.some((r) => r.role === "agency_admin");
      return {
        role: (isAdmin ? "agency_admin" : "client") as AppRole,
        clientId: client?.id ?? null,
      };
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((s) => ({ ...s, session, user: session?.user ?? null }));
      setTimeout(async () => {
        const extras = await loadExtras(session?.user ?? null);
        if (!cancelled) {
          setState({
            loading: false,
            session,
            user: session?.user ?? null,
            ...extras,
          });
        }
      }, 0);
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const extras = await loadExtras(session?.user ?? null);
      if (!cancelled) {
        setState({
          loading: false,
          session,
          user: session?.user ?? null,
          ...extras,
        });
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
