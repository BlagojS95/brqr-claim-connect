import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Tables } from "@/integrations/supabase/types";

type Signature = Pick<
  Tables<"client_signatures">,
  "signer_name" | "signed_at" | "signature_path" | "consent_version" | "consent_text"
>;

// Admin view of a client's signature on file, with a download for applying
// it to carrier forms.
export function ClientSignatureView({ signature }: { signature: Signature | undefined }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  if (!signature) return <span className="text-xs text-muted-foreground">Not signed</span>;

  async function load(open: boolean) {
    if (!open || imageUrl || !signature) return;
    const { data, error } = await supabase.storage
      .from("claim-documents")
      .createSignedUrl(signature.signature_path, 60 * 10);
    if (error || !data) {
      toast.error("Could not load the signature");
      return;
    }
    setImageUrl(data.signedUrl);
  }

  async function download() {
    const { data, error } = await supabase.storage
      .from("claim-documents")
      .createSignedUrl(signature!.signature_path, 60, {
        download: `signature-${signature!.signer_name.replace(/[^\w.-]+/g, "_")}.png`,
      });
    if (error || !data) {
      toast.error("Could not download the signature");
      return;
    }
    window.location.assign(data.signedUrl);
  }

  return (
    <Dialog onOpenChange={load}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-green-700">
          On file · View
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Signature on File</DialogTitle>
          <DialogDescription>
            Signed by {signature.signer_name} on {new Date(signature.signed_at).toLocaleString()}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border bg-white p-4 flex items-center justify-center min-h-40">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={`Signature of ${signature.signer_name}`}
              className="max-h-40"
            />
          ) : (
            <span className="text-sm text-muted-foreground">Loading…</span>
          )}
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Authorization they agreed to (version {signature.consent_version})
          </summary>
          <p className="mt-2 whitespace-pre-wrap">{signature.consent_text}</p>
        </details>
        <Button onClick={download} className="bg-navy hover:bg-navy/90 text-navy-foreground">
          Download PNG
        </Button>
      </DialogContent>
    </Dialog>
  );
}
