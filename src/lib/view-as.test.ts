import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SERVER_FN_ACCESS,
  VIEW_SESSION_MAX_HOURS,
  allowedWhileViewing,
  formatViewDuration,
  isViewSessionOpen,
  viewAsBannerText,
} from "@/lib/view-as";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// Every `const name = createServerFn(` in src/, with the file it is in.
function serverFunctions(): { name: string; file: string }[] {
  const found: { name: string; file: string }[] = [];
  for (const path of sourceFiles(SRC)) {
    const code = readFileSync(path, "utf8");
    const calls = code.match(/createServerFn\s*\(/g)?.length ?? 0;
    const named = [...code.matchAll(/const\s+(\w+)\s*=\s*createServerFn\s*\(/g)];
    // A call not assigned to a simple const (which the classifier couldn't see) fails here.
    expect(named.length, `unnamed createServerFn call in ${relative(SRC, path)}`).toBe(calls);
    for (const m of named) found.push({ name: m[1], file: relative(SRC, path) });
  }
  return found;
}

describe("server function classification for view as client", () => {
  const fns = serverFunctions();

  it("finds the server functions", () => {
    expect(fns.length).toBeGreaterThan(50);
  });

  it("classifies every server function", () => {
    const missing = fns.filter((f) => !(f.name in SERVER_FN_ACCESS));
    expect(missing, "add these to SERVER_FN_ACCESS in src/lib/view-as.ts").toEqual([]);
  });

  it("lists no function that doesn't exist", () => {
    const names = new Set(fns.map((f) => f.name));
    expect(Object.keys(SERVER_FN_ACCESS).filter((n) => !names.has(n))).toEqual([]);
  });

  it("has unique names (the check goes by name)", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const f of fns) {
      if (seen.has(f.name)) dupes.push(`${f.name}: ${seen.get(f.name)} and ${f.file}`);
      seen.set(f.name, f.file);
    }
    expect(dupes).toEqual([]);
  });

  it("allows only reads and the session functions while viewing", () => {
    expect(allowedWhileViewing("fetchAgencyOverview")).toBe(true);
    expect(allowedWhileViewing("fetchClaimActivity")).toBe(true);
    expect(allowedWhileViewing("endViewAsClient")).toBe(true);
    expect(allowedWhileViewing("submitClaim")).toBe(false);
    expect(allowedWhileViewing("addClaimNote")).toBe(false);
    expect(allowedWhileViewing("startViewAsClient")).toBe(false);
    expect(allowedWhileViewing("fetchAgencyStaff")).toBe(false);
  });

  it("refuses unknown or missing names (fail closed)", () => {
    expect(allowedWhileViewing("someNewFunction")).toBe(false);
    expect(allowedWhileViewing(undefined)).toBe(false);
    expect(allowedWhileViewing("")).toBe(false);
    expect(allowedWhileViewing("toString")).toBe(false);
    expect(allowedWhileViewing("__proto__")).toBe(false);
  });

  it("never marks a known write as read", () => {
    const writes = [
      "submitClaim",
      "addClaimNote",
      "saveClaimInternalNote",
      "updateClaimReserve",
      "importRows",
      "createLossSummaryShare",
      "createExecutiveReportShare",
      "setReportSchedule",
      "sendTestExecutiveReport",
      "createInsurGridSession",
      "inviteClientUser",
      "createClientAccount",
    ];
    for (const w of writes) expect(SERVER_FN_ACCESS[w], w).toBe("write");
  });
});

describe("viewAsBannerText", () => {
  it("names the client", () => {
    expect(viewAsBannerText("Acme Trucking")).toBe("Viewing as Acme Trucking — read only");
  });
  it("falls back when the name is empty", () => {
    expect(viewAsBannerText("  ")).toBe("Viewing as this client — read only");
  });
});

describe("isViewSessionOpen", () => {
  const start = "2026-11-16T10:00:00.000Z";
  it("is open until 8 hours have passed", () => {
    expect(VIEW_SESSION_MAX_HOURS).toBe(8);
    expect(
      isViewSessionOpen({ started_at: start, ended_at: null }, new Date("2026-11-16T17:59:00Z")),
    ).toBe(true);
    expect(
      isViewSessionOpen({ started_at: start, ended_at: null }, new Date("2026-11-16T18:00:00Z")),
    ).toBe(false);
  });
  it("is closed once ended", () => {
    expect(
      isViewSessionOpen({ started_at: start, ended_at: "2026-11-16T10:05:00Z" }, new Date(start)),
    ).toBe(false);
  });
  it("is closed for a bad timestamp", () => {
    expect(isViewSessionOpen({ started_at: "nope", ended_at: null }, new Date())).toBe(false);
  });
});

describe("formatViewDuration", () => {
  const s = "2026-11-16T10:00:00.000Z";
  it("formats minutes and hours", () => {
    expect(formatViewDuration(s, "2026-11-16T10:00:30Z")).toBe("< 1 min");
    expect(formatViewDuration(s, "2026-11-16T10:12:00Z")).toBe("12 min");
    expect(formatViewDuration(s, "2026-11-16T11:00:00Z")).toBe("1 h");
    expect(formatViewDuration(s, "2026-11-16T11:05:00Z")).toBe("1 h 5 min");
  });
  it("shows a dash for nonsense", () => {
    expect(formatViewDuration(s, "2026-11-16T09:00:00Z")).toBe("—");
    expect(formatViewDuration("x", s)).toBe("—");
  });
});
