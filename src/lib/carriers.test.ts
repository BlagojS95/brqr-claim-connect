import { describe, expect, it } from "vitest";
import { carrierShortName } from "@/lib/carriers";

describe("carrierShortName", () => {
  it("shortens the known carriers", () => {
    expect(carrierShortName("Chubb Group of Insurance Companies")).toBe("Chubb");
    expect(carrierShortName("Travelers Casualty and Surety Company")).toBe("Travelers");
    expect(carrierShortName("The Travelers Indemnity Company")).toBe("Travelers");
    expect(carrierShortName("Hartford")).toBe("Hartford");
    expect(carrierShortName("The Hartford Financial Services Group")).toBe("Hartford");
    expect(carrierShortName("Liberty Mutual Insurance")).toBe("Liberty Mutual");
  });

  it("ignores case and surrounding spaces", () => {
    expect(carrierShortName("  CHUBB INDEMNITY  ")).toBe("Chubb");
    expect(carrierShortName("liberty mutual fire")).toBe("Liberty Mutual");
  });

  it("returns other carriers unchanged", () => {
    expect(carrierShortName("Zurich North America")).toBe("Zurich North America");
    expect(carrierShortName("Chubbuck Mutual")).toBe("Chubbuck Mutual");
    expect(carrierShortName("")).toBe("");
  });

  it("passes missing values through", () => {
    expect(carrierShortName(null)).toBeNull();
    expect(carrierShortName(undefined)).toBeNull();
  });
});
