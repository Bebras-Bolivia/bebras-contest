import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePhone as backendPhone } from "../backend/src/lib/phone";
import { validatePhone as frontendPhone } from "../frontend/src/lib/phone";

const valid = [
  ["71234567", "+59171234567"],
  ["51234567", "+59151234567"],
  ["+591 5123 4567", "+59151234567"],
  ["61234567", "+59161234567"],
  ["22123456", "+59122123456"],
  [" (7123) 45-67 ", "+59171234567"],
  ["+591\u00a07123-4567", "+59171234567"],
  ["+54 (11) 2345-6789", "+541123456789"],
  ["+1 (213) 373-4253", "+12133734253"],
  ["+34 612 345 678", "+34612345678"],
  ["+44 20 7946 0018", "+442079460018"],
];
const invalid = [
  "",
  "   ",
  "abcdef",
  "7abc1234",
  "llamar al +59171234567",
  "+59171234567 ext 12",
  "1",
  "---",
  "00000000",
  "12345678",
  "59171234567",
  "0059171234567",
  "712345678",
  "+99971234567",
  "+5917123456",
  "+591712345678",
  "+1234567890123456",
  "++59171234567",
  "591+71234567",
  "71234567/22123456",
  "+59171234567😀",
  "7".repeat(101),
];

for (const [name, validate] of [
  ["backend", backendPhone],
  ["frontend", frontendPhone],
] as const) {
  test(`${name}: accepts national and international phones in canonical format`, () => {
    for (const [input, number] of valid) {
      assert.deepEqual(validate(input), { number }, input);
      assert.deepEqual(validate(number), { number }, `idempotent: ${number}`);
    }
  });
  test(`${name}: rejects invalid phones without extracting numbers from text`, () => {
    for (const input of invalid) {
      const result = validate(input);
      assert.ok(result.error, input);
      assert.equal(result.number, undefined, input);
    }
  });
}

test("phone validation errors stay consistent between UI and API", () => {
  for (const input of [...valid.map(([input]) => input), ...invalid]) {
    assert.deepEqual(frontendPhone(input), backendPhone(input), input);
  }
});
