import { useState, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  checkDuplicateClaims,
  processClaimNotifications,
  submitClaim,
} from "@/lib/claim-submission.functions";
import type { DuplicateMatch } from "@/lib/duplicate-claims";
import { DuplicateClaimsDialog } from "@/components/duplicate-claims-dialog";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import { causesOfLossQueryOptions, overviewQueryOptions } from "@/lib/query-keys";
import { uploadClaimFile } from "@/lib/claim-documents";
import { todayIso } from "@/lib/dates";
import { LINE_OF_BUSINESS } from "@/lib/line-of-business";
import { policyCoversLoss } from "@/lib/policy-match";
import { CLIENT_USER_ROLE } from "@/lib/client-users";
import { toast } from "sonner";
import { Upload } from "lucide-react";

// Select value for "Not sure"; Radix Select items can't use an empty string.
const NO_CAUSE = "none";
// Select value for "No specific location" (fix 32).
const NO_LOCATION = "none";

function TextField({
  id,
  label,
  value,
  onChange,
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<React.ComponentProps<typeof Input>, "id" | "value" | "onChange">) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </div>
  );
}

export function ClaimForm({ isNotice }: { isNotice: boolean }) {
  const navigate = useNavigate();
  const { clientId, role, user, clientRole, locationIds } = useAuth();
  const isAdmin = role === "agency_admin";
  const getOverview = useServerFn(fetchAgencyOverview);
  const submitClaimFn = useServerFn(submitClaim);
  const checkDuplicates = useServerFn(checkDuplicateClaims);
  const processNotifications = useServerFn(processClaimNotifications);

  const { data: overview } = useQuery({
    ...overviewQueryOptions("policies", getOverview),
  });

  const { data: lines = [], isError: linesFailed } = useQuery({
    queryKey: ["lines-of-business"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lines_of_business")
        .select("id, name, code")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  // Active causes only; RLS lets any signed-in user read the lookup.
  const { data: causes = [], isError: causesFailed } = useQuery(
    causesOfLossQueryOptions(async () => {
      const { data, error } = await supabase
        .from("causes_of_loss")
        .select("id, name")
        .eq("active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data;
    }),
  );

  const selectableClients = isAdmin
    ? (overview?.clients ?? []).map((c) => ({ id: c.id, name: c.company_name || c.name }))
    : [];

  const [selectedLocalClientId, setSelectedLocalClientId] = useState<string>("");
  const [lineId, setLineId] = useState("");
  const [dateOfLoss, setDateOfLoss] = useState("");
  const [timeOfLoss, setTimeOfLoss] = useState("");
  const [lossLocation, setLossLocation] = useState("");
  const [causeId, setCauseId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [claimantName, setClaimantName] = useState("");
  const [description, setDescription] = useState("");
  const [policyId, setPolicyId] = useState<string>("");
  const [reporterName, setReporterName] = useState("");
  const [reporterPhone, setReporterPhone] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [injuries, setInjuries] = useState<"" | "yes" | "no">("");
  const [vehiclesInvolved, setVehiclesInvolved] = useState("");
  const [driverName, setDriverName] = useState("");
  const [policeReportNumber, setPoliceReportNumber] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [employeeJobTitle, setEmployeeJobTitle] = useState("");
  const [injuredBodyPart, setInjuredBodyPart] = useState("");
  const [dateReportedToEmployer, setDateReportedToEmployer] = useState("");
  const [thirdPartyContact, setThirdPartyContact] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  // Files already uploaded for this report, reused if the save is retried.
  const [pendingUpload, setPendingUpload] = useState<{
    claimId: string;
    documents: { path: string; fileName: string }[];
  } | null>(null);

  useEffect(() => {
    if (!isAdmin && clientId) {
      setSelectedLocalClientId(clientId);
    }
  }, [isAdmin, clientId]);

  // Reporter defaults to the signed-in user (and, for a client, their client
  // record) until they edit any reporter field themselves.
  const reporterEdited = useRef(false);
  const ownClient = isAdmin ? undefined : overview?.clients.find((c) => c.id === clientId);
  useEffect(() => {
    if (!user || reporterEdited.current) return;
    const meta = user.user_metadata ?? {};
    setReporterEmail(user.email ?? "");
    setReporterName(meta.full_name || meta.name || ownClient?.name || "");
    setReporterPhone(user.phone || meta.phone || ownClient?.phone || "");
  }, [user, ownClient]);
  const editReporter = (set: (value: string) => void) => (value: string) => {
    reporterEdited.current = true;
    set(value);
  };

  const line = lines.find((l) => l.id === lineId);
  const lineCode = line?.code ?? null;
  const isAuto = lineCode === LINE_OF_BUSINESS.auto;
  const isWc = lineCode === LINE_OF_BUSINESS.workersComp;
  const isGl = lineCode === LINE_OF_BUSINESS.generalLiability;

  const today = todayIso();
  const clientPolicies = isAdmin
    ? (overview?.policies ?? []).filter((p) => p.client_id === selectedLocalClientId)
    : (overview?.policies ?? []);
  // Only policies whose line matches and whose term includes the date of loss.
  const policies = clientPolicies.filter((p) =>
    policyCoversLoss(
      { ...p, expiration_date: p.expiry_date },
      { dateOfLoss: dateOfLoss || null, lineOfBusinessId: lineId || null },
    ),
  );
  const policyKey = policies.map((p) => p.id).join(",");
  useEffect(() => {
    const ids = policyKey ? policyKey.split(",") : [];
    // Auto-select the only match once line and date are known; drop a pick
    // that no longer matches.
    if (ids.length === 1 && lineId && dateOfLoss) setPolicyId(ids[0]);
    else setPolicyId((current) => (ids.includes(current) ? current : ""));
  }, [policyKey, lineId, dateOfLoss]);

  // The selected client's sites (fix 32). A location user only gets their own
  // and must pick one; the server checks both again.
  const mustPickLocation = !isAdmin && clientRole === CLIENT_USER_ROLE.location;
  const locationChoices = (overview?.locations ?? []).filter(
    (l) =>
      l.client_id === selectedLocalClientId && (!mustPickLocation || locationIds.includes(l.id)),
  );
  const locationKey = locationChoices.map((l) => l.id).join(",");
  useEffect(() => {
    const ids = locationKey ? locationKey.split(",") : [];
    if (mustPickLocation && ids.length === 1) setLocationId(ids[0]);
    else setLocationId((current) => (ids.includes(current) ? current : ""));
  }, [locationKey, mustPickLocation]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(false);
  };

  // skipDuplicateCheck is true only after "Report anyway" (fix 38).
  const send = async (skipDuplicateCheck: boolean) => {
    if (!selectedLocalClientId) {
      toast.error("No client selected");
      return;
    }
    if (!line) {
      toast.error(
        linesFailed
          ? "Lines of business could not be loaded. Refresh the page and try again."
          : "Select a line of business",
      );
      return;
    }
    if (dateOfLoss > today) {
      toast.error("Date of loss can't be in the future");
      return;
    }
    if (mustPickLocation && !locationId) {
      toast.error("Choose the location this claim is for");
      return;
    }
    if (isGl && (!claimantName.trim() || !thirdPartyContact.trim())) {
      toast.error("Enter the third party's name and contact for a General Liability claim");
      return;
    }
    setBusy(true);
    try {
      const text = (v: string) => v.trim() || null;
      // Only the current line's person and vehicle, as the server keeps them.
      const probe = {
        clientId: selectedLocalClientId,
        lineOfBusinessId: line.id,
        dateOfLoss,
        claimantName: text(claimantName),
        employeeName: isWc ? text(employeeName) : null,
        vehiclesInvolved: isAuto ? text(vehiclesInvolved) : null,
      };

      // Look for possible duplicates before uploading anything, so a
      // cancelled report leaves no files behind.
      if (!skipDuplicateCheck && !pendingUpload) {
        const { duplicates: found } = await checkDuplicates({
          data: { ...probe, claimId: crypto.randomUUID() },
        });
        if (found.length) {
          setDuplicates(found);
          return;
        }
      }

      // Files go to storage first, under the id the claim will get, so the
      // server can save the claim and its document rows together. Kept for a
      // retry after the server's own duplicate check stopped the save.
      let upload = pendingUpload;
      if (!upload) {
        const claimId = crypto.randomUUID();
        const documents: { path: string; fileName: string }[] = [];
        for (const file of files) {
          try {
            documents.push(await uploadClaimFile(selectedLocalClientId, claimId, file));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : `Upload failed: ${file.name}`);
          }
        }
        upload = { claimId, documents };
        setPendingUpload(upload);
      }
      const { claimId, documents } = upload;

      const saved = await submitClaimFn({
        data: {
          claimId,
          skipDuplicateCheck,
          clientId: selectedLocalClientId,
          lineOfBusinessId: line.id,
          policyId: policyId || null,
          isNotice,
          dateOfLoss,
          claimantName: text(claimantName),
          description,
          timeOfLoss: timeOfLoss || null,
          lossLocation: text(lossLocation),
          reporterName: text(reporterName),
          reporterPhone: text(reporterPhone),
          reporterEmail: text(reporterEmail),
          injuries: injuries ? injuries === "yes" : null,
          // Only the current line's fields; the server drops any others too.
          ...(isAuto && {
            vehiclesInvolved: text(vehiclesInvolved),
            driverName: text(driverName),
            policeReportNumber: text(policeReportNumber),
          }),
          ...(isWc && {
            employeeName: text(employeeName),
            employeeJobTitle: text(employeeJobTitle),
            injuredBodyPart: text(injuredBodyPart),
            dateReportedToEmployer: dateReportedToEmployer || null,
          }),
          ...(isGl && { thirdPartyContact: text(thirdPartyContact) }),
          causeOfLossId: causeId || null,
          locationId: locationId || null,
          documents,
        },
      });

      // A matching claim arrived since the check above; nothing was saved.
      if (saved.claimId === null) {
        setDuplicates(saved.duplicates);
        return;
      }

      // The claim is saved; the email and webhook are sent (and retried) from
      // the outbox in the background. Failures show up on /admin.
      processNotifications({ data: { claimId: saved.claimId } }).catch((err) =>
        console.warn("notification processing error", err),
      );

      toast.success(isNotice ? "Incident notice submitted" : "Claim reported");
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
          {isNotice ? "Incident Notice Only" : "Report New Claim"}
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
            <SelectTrigger>
              <SelectValue placeholder="Select client" />
            </SelectTrigger>
            <SelectContent>
              {selectableClients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
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
              {lines.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="dol">Date of Loss</Label>
          <Input
            id="dol"
            type="date"
            value={dateOfLoss}
            onChange={(e) => setDateOfLoss(e.target.value)}
            max={today}
            required
          />
        </div>
        <TextField
          id="tol"
          label="Time of Loss"
          type="time"
          value={timeOfLoss}
          onChange={setTimeOfLoss}
        />
        <div className="space-y-2">
          <Label>Any Injuries?</Label>
          <Select value={injuries} onValueChange={(v) => setInjuries(v as "yes" | "no")}>
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cause">Cause of Loss (optional)</Label>
        <Select value={causeId} onValueChange={(v) => setCauseId(v === NO_CAUSE ? "" : v)}>
          <SelectTrigger id="cause">
            <SelectValue placeholder={causesFailed ? "Could not load causes" : "Select cause"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CAUSE}>Not sure</SelectItem>
            {causes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {locationChoices.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="site">{mustPickLocation ? "Location" : "Location (optional)"}</Label>
          <Select
            value={locationId}
            onValueChange={(v) => setLocationId(v === NO_LOCATION ? "" : v)}
          >
            <SelectTrigger id="site">
              <SelectValue placeholder="Select location" />
            </SelectTrigger>
            <SelectContent>
              {!mustPickLocation && (
                <SelectItem value={NO_LOCATION}>No specific location</SelectItem>
              )}
              {locationChoices.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <TextField
        id="location"
        label="Loss Location"
        value={lossLocation}
        onChange={setLossLocation}
        placeholder="Address or description of where it happened"
        maxLength={500}
      />

      {!isGl && (
        <TextField
          id="claimant"
          label="Claimant Name"
          value={claimantName}
          onChange={setClaimantName}
          placeholder="Person or company making the claim"
          maxLength={200}
        />
      )}

      {isAuto && (
        <div className="rounded-md border border-border p-4 space-y-4">
          <h2 className="font-semibold text-navy">Auto Details</h2>
          <div className="space-y-2">
            <Label htmlFor="vehicles">Vehicles Involved</Label>
            <Textarea
              id="vehicles"
              rows={3}
              value={vehiclesInvolved}
              onChange={(e) => setVehiclesInvolved(e.target.value)}
              placeholder="Year, make, model and plate of each vehicle"
              maxLength={2000}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField
              id="driver"
              label="Driver"
              value={driverName}
              onChange={setDriverName}
              maxLength={200}
            />
            <TextField
              id="police"
              label="Police Report Number"
              value={policeReportNumber}
              onChange={setPoliceReportNumber}
              maxLength={100}
            />
          </div>
        </div>
      )}

      {isWc && (
        <div className="rounded-md border border-border p-4 space-y-4">
          <h2 className="font-semibold text-navy">Injured Employee</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField
              id="employee"
              label="Employee Name"
              value={employeeName}
              onChange={setEmployeeName}
              maxLength={200}
            />
            <TextField
              id="job"
              label="Job Title"
              value={employeeJobTitle}
              onChange={setEmployeeJobTitle}
              maxLength={200}
            />
            <TextField
              id="body-part"
              label="Body Part Injured"
              value={injuredBodyPart}
              onChange={setInjuredBodyPart}
              maxLength={200}
            />
            <TextField
              id="reported-employer"
              label="Date Reported to Employer"
              type="date"
              value={dateReportedToEmployer}
              onChange={setDateReportedToEmployer}
              min={dateOfLoss || undefined}
              max={today}
            />
          </div>
        </div>
      )}

      {isGl && (
        <div className="rounded-md border border-border p-4 space-y-4">
          <h2 className="font-semibold text-navy">Third Party</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField
              id="claimant"
              label="Third-Party Name"
              value={claimantName}
              onChange={setClaimantName}
              placeholder="Person or company making the claim"
              maxLength={200}
              required
            />
            <TextField
              id="third-party-contact"
              label="Third-Party Contact"
              value={thirdPartyContact}
              onChange={setThirdPartyContact}
              placeholder="Phone, email or address"
              maxLength={500}
              required
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>Policy</Label>
        <Select value={policyId} onValueChange={setPolicyId}>
          <SelectTrigger>
            <SelectValue
              placeholder={
                policies.length
                  ? "Select policy"
                  : clientPolicies.length
                    ? "No matching policy"
                    : "No policies on file"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {policies.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.policy_number} {p.carrier ? `— ${p.carrier}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!policies.length && clientPolicies.length > 0 && (
          <p className="text-xs text-muted-foreground">
            No policy on file covers this line of business on the date of loss. You can still submit
            without a policy and the agency will match it.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="desc">Description</Label>
        <Textarea
          id="desc"
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>

      <div className="rounded-md border border-border p-4 space-y-4">
        <h2 className="font-semibold text-navy">Reported By</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <TextField
            id="reporter-name"
            label="Name"
            value={reporterName}
            onChange={editReporter(setReporterName)}
            autoComplete="name"
            maxLength={200}
          />
          <TextField
            id="reporter-phone"
            label="Phone"
            type="tel"
            value={reporterPhone}
            onChange={editReporter(setReporterPhone)}
            autoComplete="tel"
            maxLength={50}
          />
          <TextField
            id="reporter-email"
            label="Email"
            type="email"
            value={reporterEmail}
            onChange={editReporter(setReporterEmail)}
            autoComplete="email"
            maxLength={254}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Upload Documents</Label>
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-md p-6 cursor-pointer hover:bg-muted/30">
          <Upload className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm text-muted-foreground mt-2">
            {files.length
              ? `${files.length} file(s) selected`
              : "Click to upload (multiple allowed)"}
          </span>
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []));
              setPendingUpload(null);
            }}
          />
        </label>
      </div>

      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={busy}
          className="bg-navy hover:bg-navy/90 text-navy-foreground"
        >
          {busy ? "Submitting…" : "Submit"}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate({ to: "/home" })}>
          Cancel
        </Button>
      </div>

      <DuplicateClaimsDialog
        duplicates={duplicates}
        onReportAnyway={() => void send(true)}
        onCancel={() => setDuplicates(null)}
      />
    </form>
  );
}
