import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  customizedStatus,
  desiredFirebaseEmailConfig,
  firebaseEmailConfigDrift,
  firebaseEmailTarget,
  firebaseEmailUpdateMask,
  parseFirebaseEmailConfigArgs,
} from "./firebase-email-config-options";

describe("Firebase verification email configuration", () => {
  test("requires an explicit known project and defaults to check", () => {
    assert.throws(
      () => parseFirebaseEmailConfigArgs([]),
      /Debes indicar --project/u,
    );
    assert.throws(
      () => parseFirebaseEmailConfigArgs(["--project", "bebras-bo"]),
      /staging o production/u,
    );
    assert.deepEqual(parseFirebaseEmailConfigArgs(["--project", "staging"]), {
      target: firebaseEmailTarget("staging"),
      apply: false,
    });
    assert.equal(
      parseFirebaseEmailConfigArgs(["--project", "production", "--check"])
        .apply,
      false,
    );
  });

  test("requires explicit apply and rejects duplicate or unknown flags", () => {
    assert.equal(
      parseFirebaseEmailConfigArgs(["--project", "staging", "--apply"]).apply,
      true,
    );
    assert.throws(
      () =>
        parseFirebaseEmailConfigArgs([
          "--project",
          "staging",
          "--project",
          "production",
        ]),
      /--project no puede repetirse/u,
    );
    assert.throws(
      () =>
        parseFirebaseEmailConfigArgs([
          "--project",
          "staging",
          "--check",
          "--apply",
        ]),
      /como máximo una vez/u,
    );
    assert.throws(
      () => parseFirebaseEmailConfigArgs(["--project", "staging", "--force"]),
      /Argumento desconocido/u,
    );
  });

  test("maps staging and production to their exact projects and callbacks", () => {
    assert.deepEqual(firebaseEmailTarget("staging"), {
      environment: "staging",
      projectId: "bebras-bo-staging",
      callbackUri:
        "https://bebras-contest-staging.bebrasbolivia.workers.dev/auth/action",
    });
    assert.deepEqual(firebaseEmailTarget("production"), {
      environment: "production",
      projectId: "bebras-bo",
      callbackUri:
        "https://bebras-contest.bebrasbolivia.workers.dev/auth/action",
    });
  });

  test("builds the Spanish locale desired state", () => {
    const desired = desiredFirebaseEmailConfig(firebaseEmailTarget("staging"));
    assert.equal(desired.notification?.defaultLocale, "es");
    assert.equal(desired.notification?.sendEmail, undefined);
    assert.equal(firebaseEmailUpdateMask, "notification.defaultLocale");
  });

  test("reports only owned-field drift and tracks customized separately", () => {
    const desired = desiredFirebaseEmailConfig(
      firebaseEmailTarget("production"),
    );
    assert.deepEqual(
      firebaseEmailConfigDrift({}, desired).map(({ field }) => field),
      ["notification.defaultLocale"],
    );
    assert.deepEqual(firebaseEmailConfigDrift(desired, desired), []);

    const current = structuredClone(desired);
    current.notification!.defaultLocale = "en";
    current.notification!.sendEmail = {
      callbackUri: "https://example.firebaseapp.com/__/auth/action",
      verifyEmailTemplate: { subject: "Old subject" },
    };
    current.notification!.sendEmail!.verifyEmailTemplate!.customized = false;
    current.notification!.sendEmail!.verifyEmailTemplate!.replyTo =
      "ignored@example.org";

    assert.deepEqual(
      firebaseEmailConfigDrift(current, desired).map(({ field }) => field),
      ["notification.defaultLocale"],
    );
    assert.equal(customizedStatus(current), "false");
    assert.equal(customizedStatus(desired), "absent");
    current.notification!.sendEmail!.verifyEmailTemplate!.customized = true;
    assert.equal(customizedStatus(current), "true");
  });
});
