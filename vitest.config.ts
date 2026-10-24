import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    // Dependency checks read a fixture instead of the network, so tests are deterministic.
    env: { CODELAUNDRY_DEPS_FIXTURE: path.resolve(import.meta.dirname, "test/fixtures/deps-fixture.json") },
  },
});
