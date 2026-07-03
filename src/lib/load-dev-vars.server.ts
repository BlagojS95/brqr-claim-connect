// `vite dev` doesn't load .dev.vars (that's Wrangler/Miniflare's job, and the Cloudflare
// plugin only runs at build time) — so read it directly as a dev-only fallback.
// In production, wrangler injects real secrets into process.env and this file won't exist.
// Deliberately re-reads every call (no "load once" cache) — it's a tiny local file, and
// caching meant vars added to .dev.vars after the process started were silently never seen.
export async function loadDevVars() {
  try {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const contents = readFileSync(resolve(process.cwd(), ".dev.vars"), "utf8");
    for (const line of contents.split("\n")) {
      const i = line.indexOf("=");
      if (i === -1) continue;
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim();
      if (key && !process.env[key]) process.env[key] = value;
    }
  } catch {
    // no .dev.vars available (production) — expected, env vars come from wrangler secrets
  }
}
