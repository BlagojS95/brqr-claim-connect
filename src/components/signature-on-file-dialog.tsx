import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  SIGNATURE_CONSENT_PARAGRAPHS,
  SIGNATURE_CONSENT_TEXT,
  SIGNATURE_CONSENT_VERSION,
} from "@/lib/signature-consent";
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SNOOZE_KEY = "signature-on-file-snoozed";

function snoozed(): boolean {
  try {
    return sessionStorage.getItem(SNOOZE_KEY) === "1";
  } catch {
    return false;
  }
}

// Asks a logged-in client to put their signature on file. "Remind me later"
// only hides it for this browser session, so it comes back on the next login.
export function SignatureOnFileDialog() {
  const { user, role, clientId } = useAuth();
  const queryClient = useQueryClient();
  const pad = useRef<SignaturePadHandle>(null);
  const [dismissed, setDismissed] = useState(snoozed);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [padEmpty, setPadEmpty] = useState(true);
  const [saving, setSaving] = useState(false);

  const isClient = role === "client" && !!clientId;
  const { data: hasSignature, isLoading } = useQuery({
    queryKey: ["signature-on-file", clientId],
    enabled: isClient,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_signatures")
        .select("id")
        .eq("client_id", clientId!)
        .is("revoked_at", null)
        .limit(1);
      // Before the migration is applied the table is missing; don't nag then.
      if (error) return true;
      return data.length > 0;
    },
  });

  if (!isClient || isLoading || hasSignature || dismissed) return null;

  function snooze() {
    try {
      sessionStorage.setItem(SNOOZE_KEY, "1");
    } catch {
      // private mode etc.; it just won't stay hidden across reloads
    }
    setDismissed(true);
  }

  async function sign() {
    if (!user || !clientId || !pad.current) return;
    setSaving(true);
    try {
      const blob = await pad.current.toBlob();
      if (!blob) throw new Error("Couldn't read the signature. Please try again.");

      // First path segment is the client id, which the storage policies check.
      const path = `${clientId}/signature/${Date.now()}.png`;
      const { error: upErr } = await supabase.storage
        .from("claim-documents")
        .upload(path, blob, { contentType: "image/png" });
      if (upErr) throw upErr;

      const { error } = await supabase.from("client_signatures").insert({
        client_id: clientId,
        signer_name: name.trim(),
        signature_path: path,
        consent_version: SIGNATURE_CONSENT_VERSION,
        consent_text: SIGNATURE_CONSENT_TEXT,
        signed_by: user.id,
        user_agent: navigator.userAgent,
      });
      if (error) throw error;

      toast.success("Signature saved. Thank you!");
      queryClient.invalidateQueries({ queryKey: ["signature-on-file", clientId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save signature");
    } finally {
      setSaving(false);
    }
  }

  const canSign = agreed && !padEmpty && name.trim().length > 1 && !saving;

  return (
    <Dialog open onOpenChange={(open) => !open && snooze()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Signature on File</DialogTitle>
          <DialogDescription>
            Carriers often need your signature to release loss runs and process forms. Sign once
            here so your agent doesn't have to ask you every time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4 text-sm">
          {SIGNATURE_CONSENT_PARAGRAPHS.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="signer-name">Full legal name</Label>
          <Input id="signer-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Sign below</Label>
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-navy"
              onClick={() => pad.current?.clear()}
            >
              Clear
            </button>
          </div>
          <SignaturePad ref={pad} onChange={setPadEmpty} />
        </div>

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            className="mt-0.5"
          />
          I have read and agree to the authorization above.
        </label>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={snooze} disabled={saving}>
            Remind me later
          </Button>
          <Button
            onClick={sign}
            disabled={!canSign}
            className="bg-navy hover:bg-navy/90 text-navy-foreground"
          >
            {saving ? "Saving…" : "Sign and accept"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
