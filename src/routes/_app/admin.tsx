import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import type { AgencyClient } from "@/lib/overview.types";
import { createClientAccount, resetClientPassword, deleteClientAccount } from "@/lib/accounts.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { StatusBadge } from "@/components/status-badge";
import { CsvImportCard } from "@/components/csv-import-card";
import { ClientSignatureView } from "@/components/client-signature-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/admin")({
  component: AdminPage,
});

function AdminPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const getOverview = useServerFn(fetchAgencyOverview);
  const createAccount = useServerFn(createClientAccount);
  const resetPassword = useServerFn(resetClientPassword);
  const deleteAccount = useServerFn(deleteClientAccount);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-overview"],
    enabled: role === "agency_admin",
    queryFn: () => getOverview({ data: { scope: "claims" } }),
  });

  const createAccountMutation = useMutation({
    mutationFn: (input: { clientId: string; email: string; password: string }) => createAccount({ data: input }),
    onSuccess: () => {
      toast.success("Account created");
      qc.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create account"),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (input: { userId: string; password: string }) => resetPassword({ data: input }),
    onSuccess: () => toast.success("Password reset"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to reset password"),
  });

  const deleteAccountMutation = useMutation({
    mutationFn: (input: { userId: string }) => deleteAccount({ data: input }),
    onSuccess: () => {
      toast.success("Account deleted");
      qc.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete account"),
  });

  const { data: lossRunRequests = [] } = useQuery({
    queryKey: ["admin-loss-run-requests"],
    enabled: role === "agency_admin",
    queryFn: async () => {
      const { data } = await supabase
        .from("loss_run_requests")
        .select("*")
        .eq("status", "Pending")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Newest active signature per client, for the Signature column.
  const { data: signatures } = useQuery({
    queryKey: ["admin-client-signatures"],
    enabled: role === "agency_admin",
    queryFn: async () => {
      const { data } = await supabase
        .from("client_signatures")
        .select("client_id, signer_name, signed_at, signature_path, consent_version, consent_text")
        .is("revoked_at", null)
        .order("signed_at", { ascending: false });
      const byClient = new Map<string, NonNullable<typeof data>[number]>();
      for (const s of data ?? []) if (!byClient.has(s.client_id)) byClient.set(s.client_id, s);
      return byClient;
    },
  });

  const addLossRunMutation = useMutation({
    mutationFn: async (input: LossRunInput) => {
      const safeName = input.file.name.replace(/[^\w.-]+/g, "_");
      const path = `${input.clientId}/loss-runs/${Date.now()}-${safeName}`;
      const bucket = supabase.storage.from("claim-documents");
      const { error: upErr } = await bucket.upload(path, input.file);
      if (upErr) throw upErr;
      const { error } = await supabase.from("loss_runs").insert({
        client_id: input.clientId,
        year: input.year,
        total_claims: input.totalClaims,
        total_paid: input.totalPaid,
        total_incurred: input.totalIncurred,
        document_url: path,
      });
      if (error) {
        await bucket.remove([path]);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Loss run attached");
      qc.invalidateQueries({ queryKey: ["loss-runs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to attach loss run"),
  });

  const fulfillRequestMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("loss_run_requests")
        .update({ status: "Fulfilled", fulfilled_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request marked fulfilled");
      qc.invalidateQueries({ queryKey: ["admin-loss-run-requests"] });
      qc.invalidateQueries({ queryKey: ["loss-run-requests"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update request"),
  });

  if (role !== "agency_admin") {
    return <div className="text-muted-foreground">Admin access required.</div>;
  }

  const clients = data?.clients ?? [];
  const claims = data?.claims ?? [];
  const openClaims = claims.filter((c) => c.status === "Open");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-navy">Admin</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage all clients and open claims.</p>
      </div>

      <CsvImportCard />

      <section className="rounded-lg border border-border bg-card">
        <div className="p-5 border-b border-border">
          <h2 className="font-semibold text-navy">Clients ({clients.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Company</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Client #</th>
                <th className="text-left p-3">Claims</th>
                <th className="text-left p-3">Account</th>
                <th className="text-left p-3">Signature</th>
                <th className="text-left p-3">Loss Runs</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && clients.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No clients yet. Import a CSV above.</td></tr>
              )}
              {clients.map((c) => {
                const userId = c.user_id;
                return (
                  <tr key={c.id} className="border-t border-border">
                    <td className="p-3">{c.name}</td>
                    <td className="p-3">{c.company_name ?? "—"}</td>
                    <td className="p-3">{c.email ?? "—"}</td>
                    <td className="p-3 font-mono text-xs">{c.ams360_id ?? "—"}</td>
                    <td className="p-3">{c.claims_count}</td>
                    <td className="p-3">
                      {userId ? (
                        <AccountActions
                          email={c.email ?? ""}
                          onReset={(password) => resetPasswordMutation.mutate({ userId, password })}
                          onDelete={() => deleteAccountMutation.mutate({ userId })}
                        />
                      ) : (
                        <CreateAccountDialog
                          client={c}
                          onCreate={(input) => createAccountMutation.mutate(input)}
                        />
                      )}
                    </td>
                    <td className="p-3">
                      <ClientSignatureView signature={signatures?.get(c.id)} />
                    </td>
                    <td className="p-3">
                      <AddLossRunDialog client={c} onAdd={(input) => addLossRunMutation.mutate(input)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="p-5 border-b border-border">
          <h2 className="font-semibold text-navy">Loss Run Requests ({lossRunRequests.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Client</th>
                <th className="text-left p-3">Years</th>
                <th className="text-left p-3">Lines</th>
                <th className="text-left p-3">Notes</th>
                <th className="text-left p-3"></th>
              </tr>
            </thead>
            <tbody>
              {lossRunRequests.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No pending requests.</td></tr>
              )}
              {lossRunRequests.map((r) => {
                const client = clients.find((c) => c.id === r.client_id);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-3">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="p-3">{client ? client.company_name || client.name : "—"}</td>
                    <td className="p-3">{(r.years ?? []).join(", ")}</td>
                    <td className="p-3 text-xs">{(r.lines_of_business ?? []).join(", ")}</td>
                    <td className="p-3 text-xs">{r.notes ?? "—"}</td>
                    <td className="p-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={fulfillRequestMutation.isPending}
                        onClick={() => fulfillRequestMutation.mutate(r.id)}
                      >
                        Mark fulfilled
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-navy">Open Claims ({openClaims.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Claim #</th>
                <th className="text-left p-3">Adjuster</th>
                <th className="text-left p-3">Paid</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {openClaims.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="p-3">{c.date_of_loss ? new Date(c.date_of_loss).toLocaleDateString() : "—"}</td>
                  <td className="p-3">{c.claim_type}</td>
                  <td className="p-3 font-mono text-xs">
                    <Link to="/claims/$claimId" params={{ claimId: c.id }} className="text-navy hover:text-gold">
                      {c.claim_number ?? "—"}
                    </Link>
                  </td>
                  <td className="p-3">{c.adjuster_name ?? "—"}</td>
                  <td className="p-3">${Number(c.paid_amount ?? 0).toLocaleString()}</td>
                  <td className="p-3"><StatusBadge status={c.status} /></td>
                </tr>
              ))}
              {openClaims.length === 0 && !isLoading && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No open claims.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function generateTempPassword() {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8).toUpperCase() + "!";
}

function CreateAccountDialog({
  client,
  onCreate,
}: {
  client: AgencyClient;
  onCreate: (input: { clientId: string; email: string; password: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    email: client.email ?? "",
    password: "",
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Create Account</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Login for {client.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Temporary Password</Label>
            <div className="flex gap-2">
              <Input
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min 8 characters"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setForm({ ...form, password: generateTempPassword() })}
              >
                Generate
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Share this with the client directly — it won't be shown again.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            className="bg-navy hover:bg-navy/90 text-navy-foreground"
            disabled={!form.email || form.password.length < 8}
            onClick={() => {
              onCreate({
                clientId: client.id,
                email: form.email,
                password: form.password,
              });
              setOpen(false);
            }}
          >
            Create Account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface LossRunInput {
  clientId: string;
  year: number;
  file: File;
  totalClaims: number;
  totalPaid: number;
  totalIncurred: number;
}

function AddLossRunDialog({
  client,
  onAdd,
}: {
  client: AgencyClient;
  onAdd: (input: LossRunInput) => void;
}) {
  const emptyForm = {
    year: String(new Date().getFullYear()),
    totalClaims: "",
    totalPaid: "",
    totalIncurred: "",
  };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState<File | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Add Loss Run</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Attach Loss Run for {client.company_name || client.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Year</Label>
            <Input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>File</Label>
            <Input type="file" accept=".pdf,.xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label>Claims</Label>
              <Input
                type="number"
                min={0}
                value={form.totalClaims}
                onChange={(e) => setForm({ ...form, totalClaims: e.target.value })}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <Label>Paid ($)</Label>
              <Input
                type="number"
                min={0}
                value={form.totalPaid}
                onChange={(e) => setForm({ ...form, totalPaid: e.target.value })}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <Label>Incurred ($)</Label>
              <Input
                type="number"
                min={0}
                value={form.totalIncurred}
                onChange={(e) => setForm({ ...form, totalIncurred: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Totals are optional. The client sees this file in their Loss Run Library.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            className="bg-navy hover:bg-navy/90 text-navy-foreground"
            disabled={!file || !Number(form.year)}
            onClick={() => {
              if (!file) return;
              onAdd({
                clientId: client.id,
                year: Number(form.year),
                file,
                totalClaims: Number(form.totalClaims) || 0,
                totalPaid: Number(form.totalPaid) || 0,
                totalIncurred: Number(form.totalIncurred) || 0,
              });
              setForm(emptyForm);
              setFile(null);
              setOpen(false);
            }}
          >
            Attach
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountActions({
  email,
  onReset,
  onDelete,
}: {
  email: string;
  onReset: (password: string) => void;
  onDelete: () => void;
}) {
  const [resetOpen, setResetOpen] = useState(false);
  const [password, setPassword] = useState("");

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{email}</span>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="ghost">Reset Password</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset Password for {email}</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label>New Password</Label>
            <div className="flex gap-2">
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters"
              />
              <Button type="button" variant="outline" onClick={() => setPassword(generateTempPassword())}>
                Generate
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Share this with the client directly — it won't be shown again.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button
              className="bg-navy hover:bg-navy/90 text-navy-foreground"
              disabled={password.length < 8}
              onClick={() => {
                onReset(password);
                setPassword("");
                setResetOpen(false);
              }}
            >
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">Delete</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete login for {email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes their login. They won't be able to sign in again unless a new account is created for them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
