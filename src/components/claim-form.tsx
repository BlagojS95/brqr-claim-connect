import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notifyNewClaim } from "@/lib/claims.functions";
import { toast } from "sonner";
import { Upload } from "lucide-react";

type Policy = { id: string; policy_number: string; carrier: string | null; client_id: string };

export function ClaimForm({ isNotice }: { isNotice: boolean }) {
  const navigate = useNavigate();
  const { clientId, role } = useAuth();
  const isAdmin = role === "agency_admin";
  const notify = useServerFn(notifyNewClaim);

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [claimType, setClaimType] = useState("GL");
  const [dateOfLoss, setDateOfLoss] = useState("");
  const [description, setDescription] = useState("");
  const [policyId, setPolicyId] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (isAdmin) {
        const { data } = await supabase.from("clients").select("id, name").order("name");
        setClients(data ?? []);
      } else if (clientId) {
        setSelectedClient(clientId);
      }
    })();
  }, [isAdmin, clientId]);

  useEffect(() => {
    if (!selectedClient) { setPolicies([]); return; }
    supabase.from("policies").select("id, policy_number, carrier, client_id").eq("client_id", selectedClient)
      .then(({ data }) => setPolicies(data ?? []));
  }, [selectedClient]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) {
      toast.error("No client selected");
      return;
    }
    setBusy(true);
    try {
      const policy = policies.find((p) => p.id === policyId);
      const { data: claim, error } = await supabase
        .from("claims")
        .insert({
          client_id: selectedClient,
          policy_id: policyId || null,
          claim_type: claimType,
          is_notice_only: isNotice,
          date_of_loss: dateOfLoss || null,
          description,
          carrier: policy?.carrier ?? null,
          status: isNotice ? "Pending" : "Open",
        })
        .select()
        .single();
      if (error) throw error;

      // Upload documents
      for (const file of files) {
        const path = `${selectedClient}/${claim.id}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from("claim-documents").upload(path, file);
        if (upErr) { toast.error(`Upload failed: ${file.name}`); continue; }
        const { data: signed } = await supabase.storage.from("claim-documents").createSignedUrl(path, 60 * 60 * 24 * 365);
        await supabase.from("documents").insert({
          claim_id: claim.id,
          client_id: selectedClient,
          file_name: file.name,
          file_url: signed?.signedUrl ?? path,
        });
      }

      // Fire webhook
      try {
        await notify({ data: { claim_id: claim.id, client_id: selectedClient } });
      } catch (err) {
        console.warn("webhook error", err);
      }

      toast.success(isNotice ? "Notice of claim submitted" : "Claim reported");
      navigate({ to: "/claims/$claimId", params: { claimId: claim.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-navy">
          {isNotice ? "Report Notice of Claim" : "Report New Claim"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isNotice
            ? "Submit a notice for an incident that may result in a future claim."
            : "Submit a First Notice of Loss to begin the claim process."}
        </p>
      </div>

      {isAdmin && (
        <div className="space-y-2">
          <Label>Client</Label>
          <Select value={selectedClient} onValueChange={setSelectedClient}>
            <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
            <SelectContent>
              {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Claim Type</Label>
          <Select value={claimType} onValueChange={setClaimType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["GL", "WC", "Auto", "Property", "Other"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="dol">Date of Loss</Label>
          <Input id="dol" type="date" value={dateOfLoss} onChange={(e) => setDateOfLoss(e.target.value)} required />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Policy</Label>
        <Select value={policyId} onValueChange={setPolicyId}>
          <SelectTrigger>
            <SelectValue placeholder={policies.length ? "Select policy" : "No policies on file"} />
          </SelectTrigger>
          <SelectContent>
            {policies.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.policy_number} {p.carrier ? `— ${p.carrier}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="desc">Description</Label>
        <Textarea id="desc" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} required />
      </div>

      <div className="space-y-2">
        <Label>Upload Documents</Label>
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-md p-6 cursor-pointer hover:bg-muted/30">
          <Upload className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm text-muted-foreground mt-2">
            {files.length ? `${files.length} file(s) selected` : "Click to upload (multiple allowed)"}
          </span>
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={busy} className="bg-navy hover:bg-navy/90 text-navy-foreground">
          {busy ? "Submitting…" : "Submit"}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate({ to: "/dashboard" })}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
