import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = "sha256";

export function createPasswordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString("hex");
  return `pbkdf2:${PASSWORD_DIGEST}:${PASSWORD_ITERATIONS}:${salt}:${hash}`;
}

export function verifyPassword(password, encodedHash) {
  if (typeof encodedHash !== "string" || !encodedHash.startsWith("pbkdf2:")) {
    return false;
  }
  const parts = encodedHash.split(":");
  if (parts.length !== 5) {
    return false;
  }
  const [, digest, iterationsRaw, salt, expectedHash] = parts;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }
  const actualHash = pbkdf2Sync(password, salt, iterations, PASSWORD_KEY_LENGTH, digest).toString("hex");
  return timingSafeEqualHex(actualHash, expectedHash);
}

function timingSafeEqualHex(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
