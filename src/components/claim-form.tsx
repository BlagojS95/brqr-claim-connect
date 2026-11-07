import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { processClaimNotifications, submitClaim } from "@/lib/claim-submission.functions";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import { uploadClaimFile } from "@/lib/claim-documents";
import { toast } from "sonner";
import { Upload } from "lucide-react";

export function ClaimForm({ isNotice }: { isNotice: boolean }) {
  const navigate = useNavigate();
  const { clientId, role } = useAuth();
  const isAdmin = role === "agency_admin";
  const getOverview = useServerFn(fetchAgencyOverview);
  const submitClaimFn = useServerFn(submitClaim);
  const processNotifications = useServerFn(processClaimNotifications);

  const { data: overview } = useQuery({
    queryKey: ["claim-form-policies"],
    queryFn: () => getOverview({ data: { scope: "policies" } }),
  });

  const { data: lines = [], isError: linesFailed } = useQuery({
    queryKey: ["lines-of-business"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lines_of_business")
        .select("id, name")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const selectableClients = isAdmin
    ? (overview?.clients ?? []).map((c) => ({ id: c.id, name: c.company_name || c.name }))
    : [];

  const [selectedLocalClientId, setSelectedLocalClientId] = useState<string>("");
  const [lineId, setLineId] = useState("");
  const [dateOfLoss, setDateOfLoss] = useState("");
  const [claimantName, setClaimantName] = useState("");
  const [description, setDescription] = useState("");
  const [policyId, setPolicyId] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin && clientId) {
      setSelectedLocalClientId(clientId);
    }
  }, [isAdmin, clientId]);

  const policies = isAdmin
    ? (overview?.policies ?? []).filter((p) => p.client_id === selectedLocalClientId)
    : (overview?.policies ?? []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocalClientId) {
      toast.error("No client selected");
      return;
    }
    const line = lines.find((l) => l.id === lineId);
    if (!line) {
      toast.error(
        linesFailed
          ? "Lines of business could not be loaded. Refresh the page and try again."
          : "Select a line of business",
      );
      return;
    }
    setBusy(true);
    try {
      // Files go to storage first, under the id the claim will get, so the
      // server can save the claim and its document rows together.
      const claimId = crypto.randomUUID();
      const documents: { path: string; fileName: string }[] = [];
      for (const file of files) {
        try {
          documents.push(await uploadClaimFile(selectedLocalClientId, claimId, file));
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `Upload failed: ${file.name}`);
        }
      }

      const saved = await submitClaimFn({
        data: {
          claimId,
          clientId: selectedLocalClientId,
          lineOfBusinessId: line.id,
          policyId: policyId || null,
          isNotice,
          dateOfLoss,
          claimantName: claimantName.trim() || null,
          description,
          documents,
        },
      });

      // The claim is saved; the email and webhook are sent (and retried) from
      // the outbox in the background. Failures show up on /admin.
      processNotifications({ data: { claimId: saved.claimId } }).catch((err) =>
        console.warn("notification processing error", err),
      );

      toast.success(isNotice ? "Notice of claim submitted" : "Claim reported");
      navigate({ to: "/claims/$claimId", params: { claimId: saved.claimId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6 max-w-3xl mx-auto">
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
          <Select
            value={selectedLocalClientId}
            onValueChange={(id) => {
              setSelectedLocalClientId(id);
              setPolicyId("");
            }}
          >
            <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
            <SelectContent>
              {selectableClients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Line of Business</Label>
          <Select value={lineId} onValueChange={setLineId}>
            <SelectTrigger>
              <SelectValue placeholder={linesFailed ? "Could not load lines" : "Select line"} />
            </SelectTrigger>
            <SelectContent>
              {lines.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="dol">Date of Loss</Label>
          <Input id="dol" type="date" value={dateOfLoss} onChange={(e) => setDateOfLoss(e.target.value)} required />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="claimant">Claimant Name</Label>
        <Input
          id="claimant"
          value={claimantName}
          onChange={(e) => setClaimantName(e.target.value)}
          placeholder="Person or company making the claim"
        />
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
