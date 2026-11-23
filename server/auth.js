import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const demoStaffEmail = "pharmacist@demo.pharmarchy.test";
export const defaultDemoStaffPassword = "DemoPharmarchyReview2026!";

const scryptOptions = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
};

function derivePasswordHash(password, salt) {
  return scryptSync(password, salt, 64, scryptOptions);
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const digest = derivePasswordHash(password, salt);
  return `scrypt$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

export function verifyPassword(password, encoded) {
  try {
    const [algorithm, encodedSalt, encodedDigest] = String(encoded).split("$");
    if (algorithm !== "scrypt" || !encodedSalt || !encodedDigest) return false;
    const salt = Buffer.from(encodedSalt, "base64url");
    const expected = Buffer.from(encodedDigest, "base64url");
    const received = derivePasswordHash(password, salt);
    return expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqualText(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
