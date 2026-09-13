import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIREBASE_AUTH_LANGUAGE,
  emailVerificationActionSettings,
  refreshEmailVerification,
  shouldResumeFirebaseSession,
  VERIFICATION_POLL_INTERVAL_MS,
  type EmailVerificationUser,
} from "../frontend/src/lib/email-verification";

test("verification emails use Spanish and return to the current environment", () => {
  assert.equal(FIREBASE_AUTH_LANGUAGE, "es");
  assert.deepEqual(emailVerificationActionSettings("http://localhost:4321"), {
    url: "http://localhost:4321/login?verified=1",
  });
  assert.deepEqual(
    emailVerificationActionSettings(
      "https://bebras-contest-staging.bebrasbolivia.workers.dev",
    ),
    {
      url: "https://bebras-contest-staging.bebrasbolivia.workers.dev/login?verified=1",
    },
  );
  assert.deepEqual(
    emailVerificationActionSettings(
      "https://bebras-contest.bebrasbolivia.workers.dev",
    ),
    {
      url: "https://bebras-contest.bebrasbolivia.workers.dev/login?verified=1",
    },
  );
});

test("verification recovery polls quickly and explicit returns ignore stale local sessions", () => {
  assert.equal(VERIFICATION_POLL_INTERVAL_MS, 2000);
  assert.equal(shouldResumeFirebaseSession(true, true), true);
  assert.equal(shouldResumeFirebaseSession(true, false), false);
  assert.equal(shouldResumeFirebaseSession(false, false), true);
});

test("an unverified user reloads without refreshing the token", async () => {
  const calls: string[] = [];
  const user: EmailVerificationUser = {
    emailVerified: false,
    reload: async () => {
      calls.push("reload");
    },
    getIdToken: async () => {
      calls.push("getIdToken");
      return "unused";
    },
  };

  assert.equal(await refreshEmailVerification(user), false);
  assert.deepEqual(calls, ["reload"]);
});

test("a verified user refreshes the token before opening a session", async () => {
  const calls: string[] = [];
  const user = {
    emailVerified: false,
    async reload() {
      calls.push("reload");
      this.emailVerified = true;
    },
    async getIdToken(forceRefresh?: boolean) {
      calls.push(`getIdToken:${String(forceRefresh)}`);
      return "fresh-token";
    },
  };

  assert.equal(await refreshEmailVerification(user), true);
  assert.deepEqual(calls, ["reload", "getIdToken:true"]);
});

test("verification refresh surfaces Firebase reload failures", async () => {
  const user: EmailVerificationUser = {
    emailVerified: false,
    reload: async () => {
      throw new Error("offline");
    },
    getIdToken: async () => "unused",
  };

  await assert.rejects(refreshEmailVerification(user), /offline/u);
});

test("verification refresh surfaces forced token failures", async () => {
  const user: EmailVerificationUser = {
    emailVerified: true,
    reload: async () => undefined,
    getIdToken: async (forceRefresh) => {
      assert.equal(forceRefresh, true);
      throw new Error("token unavailable");
    },
  };

  await assert.rejects(refreshEmailVerification(user), /token unavailable/u);
});
