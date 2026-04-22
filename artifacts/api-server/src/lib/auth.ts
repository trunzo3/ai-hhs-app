import argon2 from "argon2";

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

export function generateResetToken(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}
