import { describe, expect, it } from "vitest";
import { requireBearer } from "../src/auth";
import { HttpError } from "../src/validate";

describe("requireBearer", () => {
  it("accepts the matching token", () => {
    expect(() => requireBearer("Bearer secret", "secret")).not.toThrow();
  });

  it("rejects missing or wrong tokens", () => {
    expect(() => requireBearer(undefined, "secret")).toThrow(HttpError);
    expect(() => requireBearer("Bearer nope", "secret")).toThrow(HttpError);
    expect(() => requireBearer("Bearer secret", undefined)).toThrow(HttpError);
  });
});
