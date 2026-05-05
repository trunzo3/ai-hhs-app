import argon2 from "argon2";
import crypto from "node:crypto";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function checkDomainMatch(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return (
    domain.endsWith(".gov") ||
    domain.endsWith(".ca.gov") ||
    domain.endsWith(".ca.us") ||
    domain.endsWith(".org") ||
    domain.endsWith(".edu")
  );
}

/**
 * Generate a cryptographically secure password-reset token.
 * Returns the raw token (sent to user via URL) and a SHA-256 hash (stored in DB).
 * Compare hashes on the reset endpoint — never store the raw token.
 */
export function generateResetToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashResetToken(token);
  return { token, tokenHash };
}

export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
