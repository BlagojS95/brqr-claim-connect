import { describe, expect, it } from "vitest";
import { CLAIM_STATUS } from "@/lib/claim-status";
import {
  WAITING_ON,
  WAITING_ON_VALUES,
  claimWaitingOn,
  daysLabel,
  daysSince,
  isWaitingOn,
  lastUpdateAt,
  waitingOnLabel,
} from "@/lib/waiting-on";
import type { Database } from "@/integrations/supabase/types";

describe("WAITING_ON", () => {
  it("matches the claim_waiting_on enum", () => {
    const dbValues: Database["public"]["Enums"]["claim_waiting_on"][] = [
      "client",
      "agency",
      "carrier",
    ];
    expect([...WAITING_ON_VALUES]).toEqual(dbValues);
  });

  it("labels each value", () => {
    expect(waitingOnLabel(WAITING_ON.client)).toBe("Client");
    expect(waitingOnLabel(WAITING_ON.agency)).toBe("Agency");
    expect(waitingOnLabel(WAITING_ON.carrier)).toBe("Carrier");
    expect(waitingOnLabel(null)).toBe("—");
  });

  it("recognises valid values only", () => {
    expect(isWaitingOn("carrier")).toBe(true);
    expect(isWaitingOn("Carrier")).toBe(false);
    expect(isWaitingOn(null)).toBe(false);
  });
});

describe("claimWaitingOn", () => {
  it("shows nothing for closed claims", () => {
    expect(claimWaitingOn({ status: CLAIM_STATUS.closed, waiting_on: WAITING_ON.agency })).toBe(
      null,
    );
  });

  it("shows the stored value otherwise", () => {
    expect(claimWaitingOn({ status: CLAIM_STATUS.open, waiting_on: WAITING_ON.carrier })).toBe(
      "carrier",
    );
    expect(claimWaitingOn({ status: CLAIM_STATUS.submitted, waiting_on: null })).toBe(null);
  });
});

describe("daysSince", () => {
  const now = new Date("2026-11-09T15:00:00Z");

  it("counts whole elapsed days", () => {
    expect(daysSince("2026-11-09T01:00:00Z", now)).toBe(0);
    expect(daysSince("2026-11-08T15:00:00Z", now)).toBe(1);
    expect(daysSince("2026-11-08T15:00:01Z", now)).toBe(0);
    expect(daysSince("2026-10-26T14:59:00+00:00", now)).toBe(14);
  });

  it("treats the future as today and missing or bad values as null", () => {
    expect(daysSince("2026-11-20T00:00:00Z", now)).toBe(0);
    expect(daysSince(null, now)).toBe(null);
    expect(daysSince(undefined, now)).toBe(null);
    expect(daysSince("not a date", now)).toBe(null);
  });
});

describe("daysLabel", () => {
  it("reads naturally", () => {
    expect(daysLabel(0)).toBe("Today");
    expect(daysLabel(1)).toBe("1 day");
    expect(daysLabel(15)).toBe("15 days");
    expect(daysLabel(null)).toBe("—");
  });
});

describe("lastUpdateAt", () => {
  it("falls back to the creation time", () => {
    expect(lastUpdateAt({ last_activity_at: "2026-11-01T00:00:00Z", created_at: "x" })).toBe(
      "2026-11-01T00:00:00Z",
    );
    expect(lastUpdateAt({ last_activity_at: null, created_at: "2026-10-01T00:00:00Z" })).toBe(
      "2026-10-01T00:00:00Z",
    );
  });
});
