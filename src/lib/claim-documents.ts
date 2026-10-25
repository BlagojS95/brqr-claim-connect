import { supabase } from "@/integrations/supabase/client";

// Storage keys reject some characters (accents, Cyrillic, etc.), so the path
// gets a cleaned-up name while documents.file_name keeps the original.
function safeKeyName(fileName: string): string {
  return (
    fileName
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "_")
      .replace(/_+/g, "_") || "file"
  );
}

// documents.file_url holds a signed URL (or the bare path if signing failed),
// so the storage path is recovered from it.
function storagePathFromUrl(fileUrl: string): string | null {
  const marker = "/claim-documents/";
  const i = fileUrl.indexOf(marker);
  if (i === -1) return fileUrl.startsWith("http") ? null : fileUrl;
  return decodeURIComponent(fileUrl.slice(i + marker.length).split("?")[0]);
}

// Removes the row first so the document disappears even if the file cleanup
// fails; a leftover file is harmless, a row pointing at nothing is not.
export async function deleteClaimDocument(doc: { id: string; file_url: string }) {
  // RLS turns a forbidden delete into "0 rows", not an error, so check the count.
  const { data, error } = await supabase.from("documents").delete().eq("id", doc.id).select("id");
  if (error) throw new Error(`Couldn't remove the document: ${error.message}`);
  if (!data?.length) throw new Error("You don't have permission to remove this document");
  const path = storagePathFromUrl(doc.file_url);
  if (path) await supabase.storage.from("claim-documents").remove([path]);
}

// The first path segment must be the client id: the storage RLS policies
// check it to decide who may read and upload the file.
export async function uploadClaimDocument(clientId: string, claimId: string, file: File) {
  const path = `${clientId}/${claimId}/${Date.now()}-${safeKeyName(file.name)}`;
  const { error: upErr } = await supabase.storage.from("claim-documents").upload(path, file);
  if (upErr) throw new Error(`Upload failed for ${file.name}: ${upErr.message}`);

  const { data: signed } = await supabase.storage
    .from("claim-documents")
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  const { error: docErr } = await supabase.from("documents").insert({
    claim_id: claimId,
    client_id: clientId,
    file_name: file.name,
    file_url: signed?.signedUrl ?? path,
  });
  if (docErr)
    throw new Error(`Uploaded ${file.name} but couldn't attach it to the claim: ${docErr.message}`);
}
