import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { fetchAgencyOverview } from "@/lib/vertafore.functions";
import type { AgencyClient } from "@/integrations/vertafore/aggregate.server";
import { fetchClientAccounts, createClientAccount } from "@/lib/accounts.functions";
import { useAuth } from "@/hooks/use-auth";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/admin")({
  component: AdminPage,
});

function AdminPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const getOverview = useServerFn(fetchAgencyOverview);
  const getAccounts = useServerFn(fetchClientAccounts);
  const createAccount = useServerFn(createClientAccount);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-overview"],
    enabled: role === "agency_admin",
    queryFn: () => getOverview(),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["client-accounts"],
    enabled: role === "agency_admin",
    queryFn: () => getAccounts(),
  });

  const createAccountMutation = useMutation({
    mutationFn: (input: { email: string; password: string; name: string; company_name: string | null; ams360_id: string }) =>
      createAccount({ data: input }),
    onSuccess: () => {
      toast.success("Account created");
      qc.invalidateQueries({ queryKey: ["client-accounts"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create account"),
  });

  if (role !== "agency_admin") {
    return <div className="text-muted-foreground">Admin access required.</div>;
  }

  const clients = data?.clients ?? [];
  const claims = data?.claims ?? [];
  const openClaims = claims.filter((c) => c.status === "Open");
  const accountByAms360Id = new Map(accounts.map((a) => [a.ams360_id, a]));

  return (
    <div className="space-y-8 max-w-7xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-navy">Admin</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage all clients and open claims.</p>
      </div>

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
                <th className="text-left p-3">AMS360</th>
                <th className="text-left p-3">Claims</th>
                <th className="text-left p-3">Account</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
              {clients.map((c) => {
                const account = accountByAms360Id.get(c.id);
                return (
                  <tr key={c.id} className="border-t border-border">
                    <td className="p-3">{c.name}</td>
                    <td className="p-3">{c.company_name ?? "—"}</td>
                    <td className="p-3">{c.email ?? "—"}</td>
                    <td className="p-3 font-mono text-xs">{c.ams360_id ?? "—"}</td>
                    <td className="p-3">{c.claims_count}</td>
                    <td className="p-3">
                      {account ? (
                        <span className="text-xs text-muted-foreground">{account.email}</span>
                      ) : (
                        <CreateAccountDialog
                          client={c}
                          onCreate={(input) => createAccountMutation.mutate(input)}
                        />
                      )}
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
  onCreate: (input: { email: string; password: string; name: string; company_name: string | null; ams360_id: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    email: client.email ?? "",
    password: "",
    name: client.name,
    company_name: client.company_name ?? "",
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
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Company</Label>
            <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
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
            disabled={!form.email || form.password.length < 8 || !form.name}
            onClick={() => {
              onCreate({
                email: form.email,
                password: form.password,
                name: form.name,
                company_name: form.company_name || null,
                ams360_id: client.id,
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
