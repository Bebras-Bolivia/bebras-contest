import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCloudflareRemoteContext,
  expectedBuildBranch,
  expectedRemoteBranch,
  parseCloudflareRemoteArgs,
  remoteBranch,
} from "./cloudflare-remote-options";

describe("Cloudflare remote operations", () => {
  it("requires an explicit operation and known remote environment", () => {
    assert.deepEqual(parseCloudflareRemoteArgs(["deploy", "staging"]), {
      operation: "deploy",
      environment: "staging",
    });
    assert.deepEqual(parseCloudflareRemoteArgs(["migrations", "production"]), {
      operation: "migrations",
      environment: "production",
    });
    assert.throws(() => parseCloudflareRemoteArgs([]), /Uso:/);
    assert.throws(
      () => parseCloudflareRemoteArgs(["remove", "staging"]),
      /Operación remota inválida/,
    );
    assert.throws(
      () => parseCloudflareRemoteArgs(["deploy", "local"]),
      /Entorno remoto inválido/,
    );
  });

  it("maps each remote environment to its only writable branch", () => {
    assert.equal(expectedBuildBranch("local"), "develop");
    assert.equal(expectedBuildBranch("staging"), "staging");
    assert.equal(expectedBuildBranch("production"), "master");
    assert.equal(expectedRemoteBranch("staging"), "staging");
    assert.equal(expectedRemoteBranch("production"), "master");
    assert.doesNotThrow(() =>
      assertCloudflareRemoteContext("staging", "staging", false),
    );
    assert.doesNotThrow(() =>
      assertCloudflareRemoteContext("production", "master", false),
    );
  });

  it("rejects the wrong branch and dirty worktrees before remote writes", () => {
    assert.throws(
      () => assertCloudflareRemoteContext("production", "develop", false),
      /no puede modificar production/,
    );
    assert.throws(
      () => assertCloudflareRemoteContext("staging", "staging", true),
      /worktree debe estar limpio/,
    );
  });

  it("trusts the reported branch only inside Workers Builds", () => {
    assert.equal(remoteBranch("1", "staging", "develop"), "develop");
    assert.equal(remoteBranch("1", "staging", ""), "staging");
    assert.equal(remoteBranch(undefined, "staging", "develop"), "develop");
    assert.equal(remoteBranch("0", "master", ""), "");
  });
});
