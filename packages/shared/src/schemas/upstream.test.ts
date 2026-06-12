import { describe, expect, it } from "vitest";
import {
  UPSTREAM_RAW_RESPONSE_TEXT_MAX_CHARS,
  upstreamErrorDetailsSchema,
} from "./upstream";

describe("upstream error schemas", () => {
  it("accepts raw response text only", () => {
    const parsed = upstreamErrorDetailsSchema.parse({
      rawResponseText: "rate limited",
    });

    expect(parsed.rawResponseText).toBe("rate limited");
  });

  it("caps raw response text at the shared schema boundary", () => {
    expect(upstreamErrorDetailsSchema.safeParse({
      rawResponseText: "x".repeat(UPSTREAM_RAW_RESPONSE_TEXT_MAX_CHARS),
    }).success).toBe(true);

    expect(upstreamErrorDetailsSchema.safeParse({
      rawResponseText: "x".repeat(UPSTREAM_RAW_RESPONSE_TEXT_MAX_CHARS + 1),
    }).success).toBe(false);
  });

  it("rejects the old structured upstream response shape", () => {
    expect(upstreamErrorDetailsSchema.safeParse({
      rawResponseText: "rate limited",
      providerResponse: {
        status: 429,
        body: "rate limited",
      },
    }).success).toBe(false);
  });
});
