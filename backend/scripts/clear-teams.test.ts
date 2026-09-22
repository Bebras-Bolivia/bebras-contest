import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { clearTeamsOptions } from "./clear-teams";

describe("clear teams options", () => {
  it("requires local target and explicit destructive confirmation", () => {
    assert.throws(
      () => clearTeamsOptions(["--target", "local"]),
      /confirm-clear-teams/,
    );
    assert.throws(
      () => clearTeamsOptions(["--confirm-clear-teams"]),
      /target local/,
    );
  });

  it("accepts the complete local command and check mode", () => {
    assert.deepEqual(
      clearTeamsOptions([
        "--target",
        "local",
        "--config",
        "wrangler.jsonc",
        "--confirm-clear-teams",
        "--check",
      ]),
      {
        target: "local",
        config: resolve(import.meta.dirname, "../..", "wrangler.jsonc"),
        check: true,
      },
    );
  });
});
