import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The product is "ClaimsQR" everywhere users see it (fix 61). This fails if an
// old spelling comes back in any source file under src/.
const BANNED = [/Claims QR/i, /Claim QR/i, /BRQR Claims Portal/i];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && name !== "routeTree.gen.ts"
      ? [path]
      : [];
  });
}

describe("product name", () => {
  it("never appears as 'Claims QR' or 'BRQR Claims Portal' in src", () => {
    const offenders = sourceFiles(join(process.cwd(), "src")).filter((file) => {
      const text = readFileSync(file, "utf8");
      return BANNED.some((re) => re.test(text));
    });
    expect(offenders).toEqual([]);
  });
});
