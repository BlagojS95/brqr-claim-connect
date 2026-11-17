import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, Timer } from "lucide-react";
import { fetchStaffResponseMetrics, updateResponseTargets } from "@/lib/response-targets.functions";
import {
  formatAverageDays,
  RESPONSE_TARGET_MAX_DAYS,
  RESPONSE_TARGET_MIN_DAYS,
  STAFF_METRICS_WINDOW_DAYS,
  type ResponseTargets,
} from "@/lib/response-targets";
import { staffName, type StaffMember } from "@/lib/staff";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Response targets on the work queue (fix 56): the two business-day targets,
 * editable, and a collapsible table of average response times per staff member.
 * `targets` comes from the queue fetch; saving refetches the queue so the
 * "Past target" flags follow.
 */
export function ResponseTargetsPanel({
  targets,
  staff,
  onSaved,
}: {
  targets: ResponseTargets | undefined;
  staff: readonly StaffMember[];
  onSaved: () => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="p-4 md:p-5 border-b border-border">
        <h2 className="font-semibold text-navy flex items-center gap-2">
          <Timer className="h-4 w-4 text-gold" aria-hidden />
          Response targets
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Business days (Mon–Fri, Eastern time). Claims past a target are flagged above.
        </p>
      </div>
      <div className="p-4 md:p-5 space-y-5">
        {targets ? (
          <TargetsForm targets={targets} onSaved={onSaved} />
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        <StaffMetrics staff={staff} />
      </div>
    </section>
  );
}

function TargetsForm({ targets, onSaved }: { targets: ResponseTargets; onSaved: () => void }) {
  const update = useServerFn(updateResponseTargets);
  const [submit, setSubmit] = useState(String(targets.submitTargetDays));
  const [contact, setContact] = useState(String(targets.firstContactTargetDays));
  useEffect(() => {
    setSubmit(String(targets.submitTargetDays));
    setContact(String(targets.firstContactTargetDays));
  }, [targets.submitTargetDays, targets.firstContactTargetDays]);

  const valid = (v: string) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= RESPONSE_TARGET_MIN_DAYS && n <= RESPONSE_TARGET_MAX_DAYS;
  };
  const changed =
    Number(submit) !== targets.submitTargetDays ||
    Number(contact) !== targets.firstContactTargetDays;

  const save = useMutation({
    mutationFn: () =>
      update({
        data: { submitTargetDays: Number(submit), firstContactTargetDays: Number(contact) },
      }),
    onSuccess: () => {
      toast.success("Response targets saved");
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save the targets"),
  });

  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:flex md:items-end md:gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid(submit) && valid(contact) && changed) save.mutate();
      }}
    >
      <TargetInput
        id="target-submit"
        label="Submit to carrier within"
        value={submit}
        onChange={setSubmit}
        invalid={!valid(submit)}
      />
      <TargetInput
        id="target-contact"
        label="First carrier contact within"
        value={contact}
        onChange={setContact}
        invalid={!valid(contact)}
      />
      <Button
        type="submit"
        disabled={!changed || !valid(submit) || !valid(contact) || save.isPending}
        className="bg-navy hover:bg-navy/90 text-navy-foreground"
      >
        {save.isPending ? "Saving…" : "Save targets"}
      </Button>
    </form>
  );
}

function TargetInput({
  id,
  label,
  value,
  onChange,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <Label htmlFor={id} className="text-xs text-muted-foreground font-normal">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={RESPONSE_TARGET_MIN_DAYS}
          max={RESPONSE_TARGET_MAX_DAYS}
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
          className={cn("w-24", invalid && "border-destructive")}
        />
        <span className="text-sm text-muted-foreground whitespace-nowrap">business days</span>
      </div>
    </div>
  );
}

function StaffMetrics({ staff }: { staff: readonly StaffMember[] }) {
  const [open, setOpen] = useState(false);
  const getMetrics = useServerFn(fetchStaffResponseMetrics);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["staff-response-metrics"],
    queryFn: () => getMetrics(),
    enabled: open,
  });

  const rows = data?.rows ?? [];
  return (
    <div className="border-t border-border pt-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="staff-response-metrics"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-navy hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        Staff response times (last {STAFF_METRICS_WINDOW_DAYS} days)
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div id="staff-response-metrics" className="mt-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : isError ? (
            <p className="text-sm text-destructive">Couldn't load staff response times.</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No claims in the last {STAFF_METRICS_WINDOW_DAYS} days.
            </p>
          ) : (
            <>
              {/* Phones: one card per staff member. */}
              <ul className="md:hidden space-y-2">
                {rows.map((r) => (
                  <li
                    key={r.userId ?? "unassigned"}
                    className="rounded-md border border-border p-3"
                  >
                    <p className="font-medium text-sm">{staffName(staff, r.userId)}</p>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">Claims</dt>
                        <dd className="tabular-nums">{r.claimCount}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Avg. to submit</dt>
                        <dd className="tabular-nums">{formatAverageDays(r.avgSubmitDays)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Avg. to contact</dt>
                        <dd className="tabular-nums">{formatAverageDays(r.avgFirstContactDays)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="text-left p-2">
                        Staff member
                      </th>
                      <th scope="col" className="text-right p-2">
                        Claims
                      </th>
                      <th scope="col" className="text-right p-2">
                        Avg. business days to submit
                      </th>
                      <th scope="col" className="text-right p-2">
                        Avg. business days to first contact
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.userId ?? "unassigned"} className="border-t border-border">
                        <td className="p-2">{staffName(staff, r.userId)}</td>
                        <td className="p-2 text-right tabular-nums">{r.claimCount}</td>
                        <td className="p-2 text-right tabular-nums">
                          {formatAverageDays(r.avgSubmitDays)}
                          {r.submittedCount > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              ({r.submittedCount} sent)
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {formatAverageDays(r.avgFirstContactDays)}
                          {r.contactedCount > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              ({r.contactedCount} contacted)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Claims created in the last {STAFF_METRICS_WINDOW_DAYS} days. Averages only include
                claims where that step has been recorded.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
