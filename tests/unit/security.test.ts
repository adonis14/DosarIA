import { describe, expect, it } from "vitest";
import { classifyDbError } from "@/lib/errors";
import { rateLimit, resetRateLimits } from "@/lib/security/rate-limit";
import { safeNextPath } from "@/lib/security/redirects";
import {
  caseFiltersSchema,
  createCaseSchema,
  createReminderSchema,
  formToObject,
  invitationTokenSchema,
  password,
  updateCaseSchema,
} from "@/lib/validation";

describe("open-redirect protection", () => {
  it.each([
    ["https://evil.example/phish", "/dashboard"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
    ["/cases/abc?x=1", "/cases/abc?x=1"],
    ["/invite?token=abc", "/invite?token=abc"],
    [null, "/dashboard"],
  ])("safeNextPath(%s) → %s", (input, expected) => {
    expect(safeNextPath(input as string | null)).toBe(expected);
  });
});

describe("input validation", () => {
  const valid = {
    courtCaseNumber: "1234/3/2026",
    courtName: "Tribunalul București",
    title: "Pretenții",
    matterType: "civil",
  };

  it("accepts Romanian case number formats", () => {
    for (const n of ["1234/3/2026", "1/1/2000", "1234/3/2026/a1", "15/299/2026*"]) {
      // "*" is only allowed inside a suffix segment
      const ok = createCaseSchema.safeParse({ ...valid, courtCaseNumber: n }).success;
      expect(ok).toBe(n !== "15/299/2026*");
    }
    expect(createCaseSchema.safeParse({ ...valid, courtCaseNumber: "abc" }).success).toBe(false);
  });

  it("rejects protected / unknown fields (strict schemas)", () => {
    expect(createCaseSchema.safeParse({ ...valid, organization_id: "x" }).success).toBe(false);
    expect(updateCaseSchema.safeParse({ ...valid, status: "active", assigned_user_id: "x" }).success).toBe(false);
    expect(updateCaseSchema.safeParse({ ...valid, status: "active", organizationId: "x" }).success).toBe(false);
  });

  it("formToObject only picks whitelisted keys", () => {
    const fd = new FormData();
    fd.set("title", "x");
    fd.set("organization_id", "00000000-0000-0000-0000-000000000000");
    fd.set("role", "admin");
    expect(formToObject(fd, ["title"])).toEqual({ title: "x" });
  });

  it("rejects search input that could alter PostgREST filter grammar", () => {
    for (const q of ["a,b", "x)or(true", "title.eq.1", "%", "a_b", "x'y", 'x"y', "a:b"]) {
      expect(caseFiltersSchema.safeParse({ q }).success, q).toBe(q === "title.eq.1");
    }
    expect(caseFiltersSchema.safeParse({ q: "București 1234/3" }).success).toBe(true);
  });

  it("enforces password policy", () => {
    expect(password.safeParse("short").success).toBe(false);
    expect(password.safeParse("alllowercase123").success).toBe(false);
    expect(password.safeParse("Correct-Horse-9").success).toBe(true);
  });

  it("validates reminder dates and invitation tokens", () => {
    expect(createReminderSchema.safeParse({ title: "Termen", dueDate: "2026-12-19" }).success).toBe(true);
    expect(createReminderSchema.safeParse({ title: "Termen", dueDate: "2026-02-30" }).success).toBe(false);
    expect(createReminderSchema.safeParse({ title: "Termen", dueDate: "12/12/2026" }).success).toBe(false);
    expect(createReminderSchema.safeParse({ title: "Termen", dueDate: "1999-01-01" }).success).toBe(false);
    expect(invitationTokenSchema.safeParse("a".repeat(43)).success).toBe(true);
    expect(invitationTokenSchema.safeParse("a".repeat(42)).success).toBe(false);
    expect(invitationTokenSchema.safeParse("' or 1=1 --").success).toBe(false);
  });
});

describe("error sanitization", () => {
  it("maps database errors to generic codes", () => {
    expect(classifyDbError({ code: "42501", message: "new row violates row-level security policy for table cases" })).toBe("forbidden");
    expect(classifyDbError({ code: "23503" })).toBe("validation");
    expect(classifyDbError({ code: "23505" })).toBe("conflict");
    expect(classifyDbError({ code: "XX000" })).toBe("internal");
  });
});

describe("rate limiting", () => {
  it("blocks after the limit within a window and recovers afterwards", () => {
    resetRateLimits();
    const t0 = 1_000_000;
    expect(rateLimit("k", 2, 1000, t0).ok).toBe(true);
    expect(rateLimit("k", 2, 1000, t0 + 1).ok).toBe(true);
    const blocked = rateLimit("k", 2, 1000, t0 + 2);
    expect(blocked.ok).toBe(false);
    expect(rateLimit("k", 2, 1000, t0 + 1001).ok).toBe(true);
    expect(rateLimit("other", 2, 1000, t0 + 2).ok).toBe(true);
  });
});
