import { createHash, timingSafeEqual } from "node:crypto";

export function passwordsMatch(submitted: string, expected: string): boolean {
  const submittedDigest = createHash("sha256").update(submitted, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(submittedDigest, expectedDigest);
}
