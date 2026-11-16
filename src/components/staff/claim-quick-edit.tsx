// Quick edit slide-over for agency staff (fix 53). Opened from the staff work
// queue (fix 52) and from claim detail. Loads the claim's current values when
// opened; the server writes only what changed and logs it (old -> new) in the
// claim's activity. Admin only: the server functions check the role.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import {
  fetchClaimQuickEdit,
  updateClaimQuickEdit,
  type ClaimQuickEditData,
} from "@/lib/claim-quick-edit.functions";
import { fromDateTimeLocal, toDateTimeLocal } from "@/lib/claim-quick-edit";
import { fetchAgencyStaff } from "@/lib/staff.functions";
import { CLAIM_STATUSES, CLAIM_STATUS_LABELS, isClaimStatus } from "@/lib/claim-status";
import { WAITING_ON_LABELS, WAITING_ON_VALUES, isWaitingOn } from "@/lib/waiting-on";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export interface ClaimQuickEditProps {
  claimId: string;
  /** Called after a successful save, e.g. to refetch the queue. */
  onSaved?: () => void;
  /** Button label; defaults to "Quick edit". */
  label?: string;
}

export function ClaimQuickEditButton({
  claimId,
  onSaved,
  label = "Quick edit",
}: ClaimQuickEditProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" />
        {label}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          {open && (
            <QuickEditLoader
              claimId={claimId}
              onClose={() => setOpen(false)}
              onSaved={() => {
                setOpen(false);
                onSaved?.();
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function QuickEditLoader({
  claimId,
  onClose,
  onSaved,
}: {
  claimId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const getClaim = useServerFn(fetchClaimQuickEdit);
  const getStaff = useServerFn(fetchAgencyStaff);
  // Under the claim's own key, so saving (which invalidates the claim) refreshes it.
  const claim = useQuery({
    queryKey: [...queryKeys.claim(claimId), "quick-edit"],
    queryFn: () => getClaim({ data: { claimId } }),
    staleTime: 0,
  });
  const staff = useQuery({ queryKey: ["agency-staff"], queryFn: () => getStaff() });

  return (
    <>
      <SheetHeader className="pr-6">
        <SheetTitle className="text-navy">Quick edit</SheetTitle>
        <SheetDescription>
          {claim.data
            ? [
                claim.data.values.claim_number ?? "No claim number",
                claim.data.claimType,
                claim.data.clientName,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Loading the claim…"}
        </SheetDescription>
      </SheetHeader>
      {claim.isError && (
        <p className="mt-6 text-sm text-destructive">
          {claim.error instanceof Error ? claim.error.message : "Couldn't load the claim"}
        </p>
      )}
      {claim.data && (
        <QuickEditForm
          claimId={claimId}
          initial={claim.data}
          staff={staff.data ?? []}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

interface FormState {
  claim_number: string;
  adjuster_name: string;
  adjuster_phone: string;
  adjuster_email: string;
  status: string;
  paid_amount: string;
  reserve_amount: string;
  waiting_on: string;
  assigned_to: string;
  submitted_to_carrier_at: string;
  first_carrier_contact_at: string;
}

function toForm({ values }: ClaimQuickEditData): FormState {
  return {
    claim_number: values.claim_number ?? "",
    adjuster_name: values.adjuster_name ?? "",
    adjuster_phone: values.adjuster_phone ?? "",
    adjuster_email: values.adjuster_email ?? "",
    status: values.status,
    paid_amount: values.paid_amount == null ? "" : String(values.paid_amount),
    reserve_amount: values.reserve_amount == null ? "" : String(values.reserve_amount),
    waiting_on: values.waiting_on ?? "",
    assigned_to: values.assigned_to ?? "",
    submitted_to_carrier_at: toDateTimeLocal(values.submitted_to_carrier_at),
    first_carrier_contact_at: toDateTimeLocal(values.first_carrier_contact_at),
  };
}

function parseAmount(text: string): number | null | "invalid" {
  const trimmed = text.trim().replace(/[$,]/g, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-base md:h-9 md:text-sm";

function QuickEditForm({
  claimId,
  initial,
  staff,
  onClose,
  onSaved,
}: {
  claimId: string;
  initial: ClaimQuickEditData;
  staff: { userId: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(updateClaimQuickEdit);
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const set = (field: keyof FormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const paid = parseAmount(form.paid_amount);
  const reserve = parseAmount(form.reserve_amount);
  const amountsValid = paid !== "invalid" && reserve !== "invalid";
  // Someone no longer on the staff list stays selectable so a save doesn't drop them.
  const assignedMissing = !!form.assigned_to && !staff.some((s) => s.userId === form.assigned_to);

  const mutation = useMutation({
    mutationFn: () => {
      if (!isClaimStatus(form.status) || paid === "invalid" || reserve === "invalid") {
        throw new Error("Check the highlighted fields");
      }
      return save({
        data: {
          claimId,
          claim_number: form.claim_number,
          adjuster_name: form.adjuster_name,
          adjuster_phone: form.adjuster_phone,
          adjuster_email: form.adjuster_email,
          status: form.status,
          paid_amount: paid,
          reserve_amount: reserve,
          waiting_on: isWaitingOn(form.waiting_on) ? form.waiting_on : null,
          assigned_to: form.assigned_to || null,
          submitted_to_carrier_at: fromDateTimeLocal(form.submitted_to_carrier_at),
          first_carrier_contact_at: fromDateTimeLocal(form.first_carrier_contact_at),
        },
      });
    },
    onSuccess: ({ changes }) => {
      toast.success(
        changes.length
          ? `Saved ${changes.length} change${changes.length === 1 ? "" : "s"}`
          : "Nothing changed",
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.claim(claimId) });
      // Lists, totals and Home's attention list show these fields too.
      queryClient.invalidateQueries({ queryKey: queryKeys.overviewAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.attention });
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save the claim"),
  });

  return (
    <form
      className="mt-6 space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (amountsValid) mutation.mutate();
      }}
    >
      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Carrier
        </legend>
        <Field id="qe-claim-number" label="Carrier claim number">
          <Input
            id="qe-claim-number"
            value={form.claim_number}
            onChange={(e) => set("claim_number")(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field id="qe-adjuster-name" label="Adjuster name">
          <Input
            id="qe-adjuster-name"
            value={form.adjuster_name}
            onChange={(e) => set("adjuster_name")(e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="qe-adjuster-phone" label="Adjuster phone">
            <Input
              id="qe-adjuster-phone"
              type="tel"
              value={form.adjuster_phone}
              onChange={(e) => set("adjuster_phone")(e.target.value)}
            />
          </Field>
          <Field id="qe-adjuster-email" label="Adjuster email">
            <Input
              id="qe-adjuster-email"
              type="email"
              value={form.adjuster_email}
              onChange={(e) => set("adjuster_email")(e.target.value)}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Claim
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="qe-status" label="Status">
            <select
              id="qe-status"
              className={selectClass}
              value={form.status}
              onChange={(e) => set("status")(e.target.value)}
            >
              {CLAIM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CLAIM_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="qe-waiting-on" label="Waiting on">
            <select
              id="qe-waiting-on"
              className={selectClass}
              value={form.waiting_on}
              onChange={(e) => set("waiting_on")(e.target.value)}
            >
              <option value="">No one</option>
              {WAITING_ON_VALUES.map((w) => (
                <option key={w} value={w}>
                  {WAITING_ON_LABELS[w]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="qe-paid"
            label="Paid ($)"
            error={paid === "invalid" ? "Enter an amount of 0 or more" : undefined}
          >
            <Input
              id="qe-paid"
              inputMode="decimal"
              value={form.paid_amount}
              onChange={(e) => set("paid_amount")(e.target.value)}
              aria-invalid={paid === "invalid"}
            />
          </Field>
          <Field
            id="qe-reserve"
            label="Reserve ($)"
            error={reserve === "invalid" ? "Enter an amount of 0 or more" : undefined}
          >
            <Input
              id="qe-reserve"
              inputMode="decimal"
              value={form.reserve_amount}
              onChange={(e) => set("reserve_amount")(e.target.value)}
              aria-invalid={reserve === "invalid"}
            />
          </Field>
        </div>
        <Field id="qe-assigned" label="Assigned to">
          <select
            id="qe-assigned"
            className={selectClass}
            value={form.assigned_to}
            onChange={(e) => set("assigned_to")(e.target.value)}
          >
            <option value="">Unassigned</option>
            {assignedMissing && <option value={form.assigned_to}>Former staff member</option>}
            {staff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Response times
        </legend>
        <p className="text-xs text-muted-foreground">
          Left empty, these fill in with the current time when a carrier claim number or adjuster is
          first entered.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="qe-submitted" label="Submitted to carrier">
            <Input
              id="qe-submitted"
              type="datetime-local"
              value={form.submitted_to_carrier_at}
              onChange={(e) => set("submitted_to_carrier_at")(e.target.value)}
            />
          </Field>
          <Field id="qe-first-contact" label="First carrier contact">
            <Input
              id="qe-first-contact"
              type="datetime-local"
              value={form.first_carrier_contact_at}
              onChange={(e) => set("first_carrier_contact_at")(e.target.value)}
            />
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          className="bg-navy hover:bg-navy/90 text-navy-foreground"
          disabled={!amountsValid || mutation.isPending}
        >
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
