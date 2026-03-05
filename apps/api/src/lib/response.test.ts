import { describe, it, expect } from "vitest";
import { createSuccessResponse, createErrorResponse } from "../lib/response.js";

describe("response helpers", () => {
  it("createSuccessResponse wraps data in envelope", () => {
    const result = createSuccessResponse({ id: "123" });
    expect(result).toEqual({
      success: true,
      data: { id: "123" },
      error: null,
    });
  });

  it("createErrorResponse wraps error in envelope", () => {
    const result = createErrorResponse("validation_error", "Bad input", { field: "email" });
    expect(result).toEqual({
      success: false,
      data: null,
      error: {
        code: "validation_error",
        message: "Bad input",
        details: { field: "email" },
      },
    });
  });

  it("createErrorResponse works without details", () => {
    const result = createErrorResponse("auth_error", "Unauthorized");
    expect(result.error?.details).toBeUndefined();
  });
});
