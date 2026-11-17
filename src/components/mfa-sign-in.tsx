// Fix 51: the two second-step screens shown on /login after the password:
// enter the 6-digit code (MfaChallenge) or set up an authenticator app
// (MfaEnroll, for a login whose company requires two-step sign-in; also used
// from Settings > Security).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { formatTotpSecret, normalizeTotpCode } from "@/lib/mfa";

function CodeField({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: () => void;
  disabled?: boolean;
}) {
  return (
    <InputOTP
      maxLength={6}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus
      aria-label="6-digit code"
    >
      <InputOTPGroup>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <InputOTPSlot key={i} index={i} className="h-11 w-10 text-base" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

async function challengeAndVerify(factorId: string, code: string) {
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (challengeError) throw challengeError;
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (error) throw error;
}

/** Asks for the code of the account's first verified app. */
export function MfaChallenge({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    const digits = normalizeTotpCode(code);
    if (!digits) {
      toast.error("Enter the 6-digit code from your authenticator app");
      return;
    }
    setBusy(true);
    try {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const factor = factors.totp[0];
      if (!factor) throw new Error("No authenticator app found on this account");
      await challengeAndVerify(factor.id, digits);
      onDone();
    } catch (err) {
      setCode("");
      toast.error(err instanceof Error ? err.message : "That code didn't work");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-navy">Two-step sign-in</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enter the 6-digit code from your authenticator app.
        </p>
      </div>
      <CodeField value={code} onChange={setCode} onComplete={verify} disabled={busy} />
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={verify}
          disabled={busy || code.length < 6}
          className="flex-1 bg-navy hover:bg-navy/90 text-navy-foreground"
        >
          {busy ? "Checking…" : "Verify"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

/** Sets up an authenticator app: QR code (or key), then the first code to confirm it. */
export function MfaEnroll({
  onDone,
  onCancel,
  intro,
}: {
  onDone: () => void;
  onCancel?: () => void;
  intro?: string;
}) {
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // A half-finished attempt (never verified) would block a new one.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const f of existing?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator app",
      });
      if (cancelled) return;
      if (error || !data) {
        toast.error(error?.message ?? "Couldn't start setup");
        return;
      }
      setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const confirm = async () => {
    const digits = normalizeTotpCode(code);
    if (!factor || !digits) {
      toast.error("Enter the 6-digit code from your authenticator app");
      return;
    }
    setBusy(true);
    try {
      await challengeAndVerify(factor.id, digits);
      toast.success("Two-step sign-in is on");
      onDone();
    } catch (err) {
      setCode("");
      toast.error(err instanceof Error ? err.message : "That code didn't work");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
      <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
        <li>
          Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password).
        </li>
        <li>Scan the code below, or type the key in by hand.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {factor ? (
        <div className="flex flex-col items-start gap-3">
          <img
            src={factor.qr}
            alt="QR code to scan with your authenticator app"
            className="h-40 w-40 rounded border bg-white p-1"
          />
          <p className="text-xs text-muted-foreground">
            Can&apos;t scan? Key:{" "}
            <code className="font-mono text-foreground break-all">
              {formatTotpSecret(factor.secret)}
            </code>
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Preparing…</p>
      )}
      <CodeField value={code} onChange={setCode} onComplete={confirm} disabled={busy || !factor} />
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={confirm}
          disabled={busy || !factor || code.length < 6}
          className="bg-navy hover:bg-navy/90 text-navy-foreground"
        >
          {busy ? "Checking…" : "Turn on"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
