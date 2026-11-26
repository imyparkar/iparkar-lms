import { describe, expect, it } from "vitest";
import { GST_STATES, isGstState, isValidGstin } from "@/lib/payments/gst";

describe("GSTIN validation", () => {
  it("accepts iParkar Learning's GSTIN (check digit verified)", () => {
    expect(isValidGstin("27ATAPP7789A1ZF")).toBe(true);
    expect(isValidGstin(" 27atapp7789a1zf ")).toBe(true);
  });
  it("rejects a wrong check digit, bad format or unknown state", () => {
    expect(isValidGstin("27ATAPP7789A1ZG")).toBe(false);
    expect(isValidGstin("27ATAPP7789A1Z")).toBe(false);
    expect(isValidGstin("99ATAPP7789A1ZF")).toBe(false);
  });
  it("lists every GST state/UT code once, including Maharashtra 27", () => {
    expect(new Set(GST_STATES.map((s) => s.code)).size).toBe(GST_STATES.length);
    expect(isGstState("27")).toBe(true);
    expect(isGstState("25")).toBe(false);
  });
});
