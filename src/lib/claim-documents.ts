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
