import { describe, expect, it } from "vitest";
import { isLossRunPathFor, lossRunPath } from "./loss-run-files";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("lossRunPath", () => {
  it("puts the file in the client's loss-runs folder with a safe name", () => {
    expect(lossRunPath(CLIENT, "2025 loss run (final).pdf", 1700000000000)).toBe(
      `${CLIENT}/loss-runs/1700000000000-2025_loss_run_final_.pdf`,
    );
  });

  it("strips path separators from the file name", () => {
    const path = lossRunPath(CLIENT, "../../other/evil.pdf", 1);
    expect(path.startsWith(`${CLIENT}/loss-runs/`)).toBe(true);
    expect(isLossRunPathFor(CLIENT, path)).toBe(true);
  });
});

describe("isLossRunPathFor", () => {
  it("accepts a file directly in the client's loss-runs folder", () => {
    expect(isLossRunPathFor(CLIENT, `${CLIENT}/loss-runs/1-a.pdf`)).toBe(true);
  });

  it("rejects another client's folder, claim files and nested paths", () => {
    expect(isLossRunPathFor(CLIENT, `${OTHER}/loss-runs/1-a.pdf`)).toBe(false);
    expect(isLossRunPathFor(CLIENT, `${CLIENT}/some-claim/a.pdf`)).toBe(false);
    expect(isLossRunPathFor(CLIENT, `${CLIENT}/loss-runs/x/../../a.pdf`)).toBe(false);
    expect(isLossRunPathFor(CLIENT, `${CLIENT}/loss-runs/`)).toBe(false);
  });
});
