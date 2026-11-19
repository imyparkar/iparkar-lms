import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GET } from "@/app/.well-known/apple-developer-merchantid-domain-association/route";

describe("Apple Pay domain association", () => {
  it("serves Razorpay's verification file as plain text", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    const body = await res.text();
    expect(body).toMatch(/^[0-9a-f]+$/);
    expect(JSON.parse(Buffer.from(body, "hex").toString())).toMatchObject({ version: 1 });
  });
  it("is excluded from the sign-in middleware", () => {
    expect(readFileSync("src/middleware.ts", "utf8")).toContain("\\\\.well-known/");
  });
});
