import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, CircleDashed, FileDown, Plus, Trash2, Upload } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { queryKeys } from "@/lib/query-keys";
import { uploadClaimDocument } from "@/lib/claim-documents";
import {
  MAX_REQUEST_NAME_LENGTH,
  MAX_REQUEST_NOTE_LENGTH,
  receivedDate,
  splitDocumentRequests,
  validateDocumentRequest,
  type DocumentRequest,
} from "@/lib/document-requests";
import {
  createDocumentRequest,
  deleteDocumentRequest,
  listDocumentRequests,
} from "@/lib/document-requests.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Shared by the client card and the full list, so both read one cache entry.
function useDocumentRequests(claimId: string) {
  const list = useServerFn(listDocumentRequests);
  return useQuery({
    queryKey: queryKeys.claimDocumentRequests(claimId),
    queryFn: () => list({ data: { claimId } }),
  });
}

// A request change touches the claim's documents, activity log and waiting_on
// (all under the claim key) and the waiting-on column on the claim lists.
function useRefreshClaim(claimId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.claim(claimId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.overviewAll });
  };
}

/**
 * "Requested from you": the client's open requests at the top of the claim,
 * each with its own upload. Renders nothing when none are open.
 */
export function RequestedFromYouCard({ claimId, clientId }: { claimId: string; clientId: string }) {
  const { data } = useDocumentRequests(claimId);
  const refresh = useRefreshClaim(claimId);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const open = splitDocumentRequests(data ?? []).open;
  if (!open.length) return null;

  async function upload(request: DocumentRequest, file: File | undefined) {
    if (!file) return;
    setUploadingId(request.id);
    try {
      await uploadClaimDocument(clientId, claimId, file, { documentRequestId: request.id });
      toast.success(`Sent ${file.name} for "${request.name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Upload failed: ${file.name}`);
    } finally {
      setUploadingId(null);
      refresh();
    }
  }

  return (
    <section className="rounded-lg border border-gold/60 bg-gold/5 p-6">
      <h2 className="font-semibold text-navy">Requested from you</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        Your agency needs {open.length === 1 ? "this document" : "these documents"} to keep your
        claim moving.
      </p>
      <ul className="space-y-2">
        {open.map((r) => {
          const busy = uploadingId === r.id;
          return (
            <li
              key={r.id}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-md border border-border bg-card"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium break-words">{r.name}</div>
                {r.note && (
                  <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">
                    {r.note}
                  </p>
                )}
              </div>
              <Button
                asChild
                size="sm"
                disabled={uploadingId !== null}
                className="bg-navy hover:bg-navy/90 text-navy-foreground shrink-0 self-start sm:self-auto"
              >
                <label className="cursor-pointer">
                  <Upload className="h-3.5 w-3.5" /> {busy ? "Uploading…" : "Upload"}
                  <input
                    type="file"
                    className="hidden"
                    aria-label={`Upload ${r.name}`}
                    disabled={uploadingId !== null}
                    onChange={(e) => {
                      upload(r, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DeleteRequestButton({ name, onConfirm }: { name: string; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1 text-sm shrink-0"
        >
          <Trash2 className="h-4 w-4" /> Delete
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this request?</AlertDialogTitle>
          <AlertDialogDescription>
            The client will no longer be asked for "{name}".
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AddRequestForm({ claimId }: { claimId: string }) {
  const create = useServerFn(createDocumentRequest);
  const refresh = useRefreshClaim(claimId);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const checked = validateDocumentRequest({ name, note });

  const save = useMutation({
    mutationFn: () => create({ data: { claimId, name, note } }),
    onSuccess: () => {
      toast.success("Document requested");
      setName("");
      setNote("");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to add request"),
  });

  return (
    <form
      className="space-y-2 pt-4 mt-4 border-t border-border"
      onSubmit={(e) => {
        e.preventDefault();
        if (checked.ok) save.mutate();
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={MAX_REQUEST_NAME_LENGTH}
        placeholder="Document needed, e.g. Police report"
        aria-label="Document needed"
      />
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={MAX_REQUEST_NOTE_LENGTH}
        rows={2}
        placeholder="Note for the client (optional)"
        aria-label="Note for the client"
      />
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={!checked.ok || save.isPending}
          className="bg-navy hover:bg-navy/90 text-navy-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> {save.isPending ? "Adding…" : "Request document"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Every request on the claim, open and received. Agency admins can add and
 * delete open ones. Hidden for a client when nothing was ever requested.
 */
export function ClaimDocumentRequests({ claimId, isAdmin }: { claimId: string; isAdmin: boolean }) {
  const { data, isLoading, error } = useDocumentRequests(claimId);
  const remove = useServerFn(deleteDocumentRequest);
  const refresh = useRefreshClaim(claimId);
  const requests = data ?? [];
  if (!isAdmin && !requests.length) return null;
  const { open, fulfilled } = splitDocumentRequests(requests);

  async function deleteRequest(request: DocumentRequest) {
    try {
      await remove({ data: { requestId: request.id } });
      toast.success(`Deleted request for ${request.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete request");
    }
    refresh();
  }

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h2 className="font-semibold text-navy mb-4">Document Requests</h2>
      {isLoading && <p className="text-sm text-muted-foreground">Loading requests…</p>}
      {error && (
        <p className="text-sm text-destructive">
          Couldn't load requests: {error instanceof Error ? error.message : "Unknown error"}
        </p>
      )}
      {!isLoading && !error && !requests.length && (
        <p className="text-sm text-muted-foreground">No documents requested.</p>
      )}
      <ul className="space-y-2">
        {open.map((r) => (
          <li
            key={r.id}
            className="flex items-start justify-between gap-3 p-3 rounded-md border border-border"
          >
            <div className="flex items-start gap-2 min-w-0">
              <CircleDashed className="h-4 w-4 mt-0.5 shrink-0 text-gold" />
              <div className="min-w-0">
                <div className="text-sm font-medium break-words">{r.name}</div>
                {r.note && (
                  <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">
                    {r.note}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  Waiting on client · requested {formatDate(receivedDate(r.requested_at))}
                </p>
              </div>
            </div>
            {isAdmin && <DeleteRequestButton name={r.name} onConfirm={() => deleteRequest(r)} />}
          </li>
        ))}
        {fulfilled.map((r) => (
          <li
            key={r.id}
            className="flex items-start justify-between gap-3 p-3 rounded-md border border-border"
          >
            <div className="flex items-start gap-2 min-w-0">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-[#2d8a9e]" />
              <div className="min-w-0">
                <div className="text-sm font-medium break-words">{r.name}</div>
                <p className="text-xs text-muted-foreground mt-0.5 break-words">
                  Received {formatDate(receivedDate(r.fulfilled_at))}
                  {r.document && ` · ${r.document.file_name}`}
                </p>
              </div>
            </div>
            {r.document && (
              <a
                href={r.document.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-navy hover:text-gold inline-flex items-center gap-1 text-sm shrink-0"
              >
                <FileDown className="h-4 w-4" /> Download
              </a>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && <AddRequestForm claimId={claimId} />}
    </section>
  );
}
