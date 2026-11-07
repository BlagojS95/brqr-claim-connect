// Storage paths for loss runs an agency admin attaches to a client:
// <client_id>/loss-runs/<timestamp>-<file name>. The first segment is what the
// storage policies check, and clients can't delete anything under loss-runs/.

export function lossRunPath(clientId: string, fileName: string, now = Date.now()): string {
  const safeName = fileName.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "_") || "file";
  return `${clientId}/loss-runs/${now}-${safeName}`;
}

// True only for a single file directly in this client's loss-runs folder, so a
// caller can't attach a path that belongs to another client or a claim.
export function isLossRunPathFor(clientId: string, path: string): boolean {
  const prefix = `${clientId}/loss-runs/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/") && !rest.startsWith(".");
}
