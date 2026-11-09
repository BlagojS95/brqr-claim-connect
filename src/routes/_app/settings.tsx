import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Loader2, Mail, Send } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "@/lib/dates";
import { DIGEST_RUN_STATUSES } from "@/lib/digest";
import {
  fetchNotificationSettings,
  sendMeTestDigest,
  updateAgencyWeeklyDigest,
  updateWeeklyDigestPreference,
  type NotificationSettings,
} from "@/lib/digest.functions";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings | ClaimsQR" }] }),
  component: SettingsPage,
});

const SETTINGS_QUERY_KEY = ["notification-settings"] as const;

const RUN_STATUS_LABELS: Record<(typeof DIGEST_RUN_STATUSES)[number], string> = {
  sent: "Sent",
  skipped: "Skipped (nothing to report)",
  failed: "Failed",
};

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

// One card per section. The page is a stack of these so later sections
// (a Users section is planned) slot in below.
function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 md:p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-navy">{icon}</div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-navy">{title}</h2>
          {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-foreground cursor-pointer">
          {label}
        </label>
        <div className="text-sm text-muted-foreground mt-0.5">{description}</div>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="shrink-0 mt-0.5"
      />
    </div>
  );
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const getSettings = useServerFn(fetchNotificationSettings);
  const savePreference = useServerFn(updateWeeklyDigestPreference);
  const saveAgency = useServerFn(updateAgencyWeeklyDigest);
  const sendTest = useServerFn(sendMeTestDigest);

  const { data, isLoading, error } = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => getSettings(),
  });

  const patchCache = (patch: (prev: NotificationSettings) => NotificationSettings) =>
    queryClient.setQueryData<NotificationSettings>(SETTINGS_QUERY_KEY, (prev) =>
      prev ? patch(prev) : prev,
    );

  const preference = useMutation({
    mutationFn: (enabled: boolean) => savePreference({ data: { enabled } }),
    onSuccess: (_res, enabled) => {
      patchCache((prev) => ({ ...prev, weeklyDigest: enabled }));
      toast.success(enabled ? "Weekly digest turned on" : "Weekly digest turned off");
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't save your setting")),
  });

  const agencySwitch = useMutation({
    mutationFn: (enabled: boolean) => saveAgency({ data: { enabled } }),
    onSuccess: (_res, enabled) => {
      patchCache((prev) =>
        prev.agency ? { ...prev, agency: { ...prev.agency, weeklyDigestEnabled: enabled } } : prev,
      );
      toast.success(
        enabled ? "Weekly digest will be sent to clients" : "Weekly digest to clients turned off",
      );
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't save the agency setting")),
  });

  const testDigest = useMutation({
    mutationFn: () => sendTest(),
    onSuccess: (res) => {
      if (res.sent) toast.success(`Test digest sent to ${res.to}`);
      else toast.info("Nothing to report this week, so no test digest was sent.");
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't send the test digest")),
  });

  const weeklyDigest = preference.isPending ? preference.variables : data?.weeklyDigest;
  const agency = data?.agency;
  const agencyEnabled = agencySwitch.isPending
    ? agencySwitch.variables
    : agency?.weeklyDigestEnabled;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-navy">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Your email notifications.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
        </div>
      ) : error || !data ? (
        <p className="text-sm text-destructive">
          {errorMessage(error, "Couldn't load your settings.")}
        </p>
      ) : (
        <>
          <SettingsSection
            icon={<Mail className="h-5 w-5" />}
            title="Email notifications"
            description="Emails ClaimsQR sends to your login address."
          >
            <SwitchRow
              id="weekly-digest"
              label="Weekly digest"
              description="A Monday morning email with new claims, status changes and anything waiting on you. Only sent when there is something to report."
              checked={weeklyDigest ?? true}
              disabled={preference.isPending}
              onChange={(value) => preference.mutate(value)}
            />
          </SettingsSection>

          {agency && (
            <SettingsSection
              icon={<Building2 className="h-5 w-5" />}
              title="Agency"
              description="Only agency admins see this section."
            >
              <SwitchRow
                id="agency-weekly-digest"
                label="Send weekly digest to clients"
                description={
                  <>
                    Off until you turn it on. When on, every client login that hasn't turned off its
                    own weekly digest gets one each Monday morning.
                    <span className="block mt-1 font-medium text-foreground">
                      Currently {agencyEnabled ? "on" : "off"}.
                    </span>
                  </>
                }
                checked={agencyEnabled ?? false}
                disabled={agencySwitch.isPending}
                onChange={(value) => agencySwitch.mutate(value)}
              />

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t pt-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Test digest</div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    Sends this week's digest for all clients to your own email only. Works while the
                    switch above is off.
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="shrink-0 w-full sm:w-auto"
                  disabled={testDigest.isPending}
                  onClick={() => testDigest.mutate()}
                >
                  {testDigest.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Send me a test digest
                </Button>
              </div>

              <div className="border-t pt-4">
                <div className="text-sm font-medium text-foreground">Last run</div>
                {agency.lastRun ? (
                  <>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      Week of {formatDate(agency.lastRun.weekStart)}
                    </div>
                    <dl className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {DIGEST_RUN_STATUSES.map((status) => (
                        <div
                          key={status}
                          className="flex items-center justify-between sm:block rounded-md bg-muted/50 px-3 py-2"
                        >
                          <dt className="text-xs text-muted-foreground">
                            {RUN_STATUS_LABELS[status]}
                          </dt>
                          <dd className="text-lg font-semibold text-navy">
                            {agency.lastRun?.counts[status] ?? 0}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground mt-0.5">
                    No weekly digest has run yet.
                  </div>
                )}
              </div>
            </SettingsSection>
          )}
        </>
      )}
    </div>
  );
}
