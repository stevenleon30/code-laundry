import { describe, expect, it } from "vitest";

const mockUsers = [{ name: "John Doe", email: "john@example.com" }];

describe("users", () => {
  it("has a sample user", () => {
    expect(mockUsers[0]?.name).toBe("John Doe");
  });
});
