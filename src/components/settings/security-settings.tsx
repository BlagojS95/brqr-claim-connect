// Settings > Security (fix 51): your own authenticator app, and (for a
// company's admin, or agency staff) whether the company requires two-step
// sign-in. The setting is enforced on the server; this only edits it.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { MfaEnroll } from "@/components/mfa-sign-in";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { fetchSecuritySettings, setClientRequireMfa } from "@/lib/security.functions";

const FACTORS_KEY = ["mfa-factors"] as const;
const SECURITY_KEY = ["security-settings"] as const;

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function MyAuthenticator() {
  const queryClient = useQueryClient();
  const [enrolling, setEnrolling] = useState(false);

  const { data: factors = [], isLoading } = useQuery({
    queryKey: FACTORS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data.totp;
    },
  });

  const remove = useMutation({
    mutationFn: async (factorId: string) => {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Authenticator app removed");
      void queryClient.invalidateQueries({ queryKey: FACTORS_KEY });
      void queryClient.invalidateQueries({ queryKey: SECURITY_KEY });
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't remove it")),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (enrolling) {
    return (
      <MfaEnroll
        onCancel={() => setEnrolling(false)}
        onDone={() => {
          setEnrolling(false);
          void queryClient.invalidateQueries({ queryKey: FACTORS_KEY });
        }}
      />
    );
  }

  if (factors.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Two-step sign-in is off for you. Add an authenticator app to ask for a code at sign-in.
        </p>
        <Button
          type="button"
          onClick={() => setEnrolling(true)}
          className="bg-navy hover:bg-navy/90 text-navy-foreground"
        >
          Set up
        </Button>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {factors.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
          <span className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-teal" aria-hidden="true" />
            {f.friendly_name || "Authenticator app"} (on)
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Remove this authenticator app? You will sign in with just your password.",
                )
              ) {
                remove.mutate(f.id);
              }
            }}
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}

function CompanyRequirement() {
  const queryClient = useQueryClient();
  const getSettings = useServerFn(fetchSecuritySettings);
  const save = useServerFn(setClientRequireMfa);
  const { data } = useQuery({ queryKey: SECURITY_KEY, queryFn: () => getSettings() });

  const toggle = useMutation({
    mutationFn: (input: { clientId: string; required: boolean }) => save({ data: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SECURITY_KEY }),
    onError: (err) => toast.error(errorMessage(err, "Couldn't save the setting")),
  });

  if (!data?.manage || data.clients.length === 0) return null;
  return (
    <div className="mt-5 border-t pt-4">
      <h3 className="text-sm font-semibold text-navy">Require two-step sign-in</h3>
      <p className="text-sm text-muted-foreground mt-0.5">
        Everyone who signs in for the company must enter a code from an authenticator app. People
        without one set it up at their next sign-in.
      </p>
      <ul className="mt-2 divide-y divide-border">
        {data.clients.map((c) => (
          <li key={c.clientId} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm min-w-0 truncate">{c.clientName}</span>
            <Switch
              checked={c.requireMfa}
              disabled={toggle.isPending}
              aria-label={`Require two-step sign-in for ${c.clientName}`}
              onCheckedChange={(required) => toggle.mutate({ clientId: c.clientId, required })}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SecuritySettings() {
  return (
    <div>
      <MyAuthenticator />
      <CompanyRequirement />
    </div>
  );
}
