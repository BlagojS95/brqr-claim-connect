import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Pencil } from "lucide-react";

export const Route = createFileRoute("/_app/admin")({
  component: AdminPage,
});

type Claim = {
  id: string;
  claim_number: string | null;
  adjuster_name: string | null;
  status: string;
  reserve_amount: number | null;
  paid_amount: number | null;
  claim_type: string;
  client_id: string;
  date_of_loss: string | null;
};

function AdminPage() {
  const { role } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-overview"],
    enabled: role === "agency_admin",
    queryFn: async () => {
      const [{ data: clients }, { data: claims }] = await Promise.all([
        supabase.from("clients").select("*").order("name"),
        supabase.from("claims").select("*").order("date_of_loss", { ascending: false, nullsFirst: false }),
      ]);
      return { clients: clients ?? [], claims: (claims ?? []) as Claim[] };
    },
  });

  const update = useMutation({
    mutationFn: async (payload: Partial<Claim> & { id: string }) => {
      const { id, ...rest } = payload;
      const { error } = await supabase.from("claims").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Claim updated"); qc.invalidateQueries({ queryKey: ["admin-overview"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  if (role !== "agency_admin") {
    return <div className="text-muted-foreground">Admin access required.</div>;
  }

  const clients = data?.clients ?? [];
  const claims = data?.claims ?? [];
  const openClaims = claims.filter((c) => c.status === "Open");
  const claimsByClient = new Map<string, number>();
  for (const c of claims) claimsByClient.set(c.client_id, (claimsByClient.get(c.client_id) ?? 0) + 1);

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
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
              {clients.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="p-3">{c.name}</td>
                  <td className="p-3">{c.company_name ?? "—"}</td>
                  <td className="p-3">{c.email ?? "—"}</td>
                  <td className="p-3 font-mono text-xs">{c.ams360_id ?? "—"}</td>
                  <td className="p-3">{claimsByClient.get(c.id) ?? 0}</td>
                </tr>
              ))}
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
                <th className="text-left p-3">Reserve</th>
                <th className="text-left p-3">Paid</th>
                <th className="text-left p-3">Status</th>
                <th className="p-3"></th>
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
                  <td className="p-3">${Number(c.reserve_amount ?? 0).toLocaleString()}</td>
                  <td className="p-3">${Number(c.paid_amount ?? 0).toLocaleString()}</td>
                  <td className="p-3"><StatusBadge status={c.status} /></td>
                  <td className="p-3"><EditClaimDialog claim={c} onSave={(p) => update.mutate(p)} /></td>
                </tr>
              ))}
              {openClaims.length === 0 && !isLoading && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No open claims.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EditClaimDialog({ claim, onSave }: { claim: Claim; onSave: (p: Partial<Claim> & { id: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    claim_number: claim.claim_number ?? "",
    adjuster_name: claim.adjuster_name ?? "",
    status: claim.status,
    reserve_amount: String(claim.reserve_amount ?? 0),
    paid_amount: String(claim.paid_amount ?? 0),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Claim</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Claim Number</Label>
            <Input value={form.claim_number} onChange={(e) => setForm({ ...form, claim_number: e.target.value })} />
          </div>
          <div className="space-y-1"><Label>Adjuster</Label>
            <Input value={form.adjuster_name} onChange={(e) => setForm({ ...form, adjuster_name: e.target.value })} />
          </div>
          <div className="space-y-1"><Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Open", "Pending", "Closed"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Reserve $</Label>
              <Input type="number" value={form.reserve_amount} onChange={(e) => setForm({ ...form, reserve_amount: e.target.value })} />
            </div>
            <div className="space-y-1"><Label>Paid $</Label>
              <Input type="number" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            className="bg-navy hover:bg-navy/90 text-navy-foreground"
            onClick={() => {
              onSave({
                id: claim.id,
                claim_number: form.claim_number || null,
                adjuster_name: form.adjuster_name || null,
                status: form.status,
                reserve_amount: Number(form.reserve_amount) || 0,
                paid_amount: Number(form.paid_amount) || 0,
                last_follow_up: new Date().toISOString(),
              } as Partial<Claim> & { id: string });
              setOpen(false);
            }}
          >Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
