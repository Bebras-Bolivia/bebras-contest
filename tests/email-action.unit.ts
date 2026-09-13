import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_VERIFICATION_DESTINATION,
  parseVerifyEmailAction,
  sanitizedEmailActionPath,
  verificationDestination,
} from "../frontend/src/lib/email-action";

test("parses only verifyEmail actions with a non-empty code", () => {
  assert.deepEqual(
    parseVerifyEmailAction(
      "https://bebras.bo/auth/action?mode=verifyEmail&oobCode=abc123&continueUrl=%2Flogin%3Fverified%3D1&lang=es",
    ),
    {
      mode: "verifyEmail",
      oobCode: "abc123",
      continueUrl: "/login?verified=1",
      lang: "es",
    },
  );
  assert.equal(
    parseVerifyEmailAction("https://bebras.bo/auth/action?mode=resetPassword&oobCode=x"),
    null,
  );
  assert.equal(
    parseVerifyEmailAction("https://bebras.bo/auth/action?mode=verifyEmail&oobCode=%20"),
    null,
  );
  assert.equal(parseVerifyEmailAction("not a url"), null);
});

test("removes action secrets from the visible URL", () => {
  assert.equal(
    sanitizedEmailActionPath(
      "https://bebras.bo/auth/action?mode=verifyEmail&oobCode=secret&lang=es&keep=1#help",
    ),
    "/auth/action?keep=1#help",
  );
});

test("allows only the exact verified login route on the Worker or HTTP loopback", () => {
  const origin = "https://bebras-contest.example.workers.dev";
  assert.equal(
    verificationDestination("/login?verified=1", origin),
    DEFAULT_VERIFICATION_DESTINATION,
  );
  assert.equal(
    verificationDestination(
      "http://localhost:4421/login?verified=1",
      origin,
    ),
    "http://localhost:4421/login?verified=1",
  );
  assert.equal(
    verificationDestination(
      "http://127.0.0.1:4321/login?verified=1",
      origin,
    ),
    "http://127.0.0.1:4321/login?verified=1",
  );
});

test("rejects open redirects and near-matches", () => {
  const origin = "https://bebras-contest.example.workers.dev";
  for (const candidate of [
    "https://evil.example/login?verified=1",
    "//evil.example/login?verified=1",
    "https://localhost/login?verified=1",
    "/login?verified=1&next=https://evil.example",
    "/login?verified=0",
    "/login?verified=1#next",
    "/other?verified=1",
    "not a url",
    null,
  ]) {
    assert.equal(
      verificationDestination(candidate, origin),
      DEFAULT_VERIFICATION_DESTINATION,
    );
  }
});
