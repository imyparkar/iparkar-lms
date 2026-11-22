import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/next";

describe("safeNext (return destination after sign-in)", () => {
  it("keeps approved app routes with their query", () => {
    expect(safeNext("/courses/ASP?plan=180")).toBe("/courses/ASP?plan=180");
    expect(safeNext("/learn/pmp-sps/buy")).toBe("/learn/pmp-sps/buy");
    expect(safeNext("/free/sat")).toBe("/free/sat");
    expect(safeNext("/dashboard")).toBe("/dashboard");
  });
  it("rejects other origins and tricky paths", () => {
    for (const bad of ["https://evil.example/", "//evil.example", "/\\evil.example", "/%5Cevil", "javascript:alert(1)", "/login", "/", "/api/session", "/dashboard\n", "", null, undefined, 42]) {
      expect(safeNext(bad as unknown)).toBe("/dashboard");
    }
  });
  it("uses the given fallback", () => {
    expect(safeNext("//evil", "")).toBe("");
  });
});
