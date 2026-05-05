import { Router, type IRouter } from "express";
import { db, usersTable, passwordResetAttemptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { hashPassword, verifyPassword, checkDomainMatch, generateResetToken, hashResetToken } from "../../lib/auth";
import {
  RegisterBody,
  LoginBody,
  ForgotPasswordBody,
  ResetPasswordBody,
} from "@workspace/api-zod";
import { logger } from "../../lib/logger";
import { getSupportEmail } from "../../lib/appConfig";

const router: IRouter = Router();

const RESET_LOCKOUT_THRESHOLD = 3;
const RESET_LOCKOUT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RESET_LOCKOUT_DURATION_MS = 60 * 60 * 1000; // 1 hour

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password, county, serviceCategory, domainNote } = parsed.data;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }

  const passwordHash = await hashPassword(password);
  const domainMatch = checkDomainMatch(email);

  const [user] = await db.insert(usersTable).values({
    email: email.toLowerCase(),
    passwordHash,
    county,
    serviceCategory,
    domainMatch,
    domainNote: domainNote ?? null,
    lastActive: new Date(),
  }).returning();

  (req.session as any).userId = user.id;

  req.log.info({ userId: user.id, county }, "User registered");

  res.status(201).json({
    user: {
      id: user.id,
      email: user.email,
      county: user.county,
      serviceCategory: user.serviceCategory,
      domainMatch: user.domainMatch,
      createdAt: user.createdAt.toISOString(),
    },
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (!user) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  if (user.disabled) {
    const supportEmail = await getSupportEmail();
    res.status(403).json({ error: `Your account has been paused. If you think this is an error, reach out to ${supportEmail}.` });
    return;
  }

  (req.session as any).userId = user.id;

  await db.update(usersTable).set({ lastActive: new Date() }).where(eq(usersTable.id, user.id));

  req.log.info({ userId: user.id }, "User logged in");

  res.json({
    user: {
      id: user.id,
      email: user.email,
      county: user.county,
      serviceCategory: user.serviceCategory,
      domainMatch: user.domainMatch,
      createdAt: user.createdAt.toISOString(),
    },
  });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy((err) => {
    if (err) {
      logger.error({ err }, "Session destroy failed");
    }
    res.clearCookie("hhs_user_sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    res.json({ success: true, message: "Logged out" });
  });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const userId = (req.session as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  if (user.disabled) {
    req.session.destroy(() => {});
    const supportEmail = await getSupportEmail();
    res.status(403).json({ error: `Your account has been paused. If you think this is an error, reach out to ${supportEmail}.` });
    return;
  }

  await db.update(usersTable).set({ lastActive: new Date() }).where(eq(usersTable.id, user.id));

  res.json({
    id: user.id,
    email: user.email,
    county: user.county,
    serviceCategory: user.serviceCategory,
    domainMatch: user.domainMatch,
    createdAt: user.createdAt.toISOString(),
  });
});

router.get("/auth/support-email", async (_req, res): Promise<void> => {
  const supportEmail = await getSupportEmail();
  res.json({ supportEmail });
});

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // This endpoint is preserved for back-compat but the new self-service flow
  // is /auth/forgot-password/verify (which requires county+serviceCategory).
  // We intentionally do NOT generate a token here anymore — that would let an
  // attacker bypass the verify step. Always respond generically.
  res.json({ success: true, message: "If your account matches, you'll be guided through verification." });
});

router.post("/auth/forgot-password/verify", async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const county = typeof req.body?.county === "string" ? req.body.county.trim() : "";
  const serviceCategory = typeof req.body?.serviceCategory === "string" ? req.body.serviceCategory.trim() : "";

  if (!email || !county || !serviceCategory) {
    res.status(400).json({ error: "Email, county, and service category are required." });
    return;
  }

  const supportEmail = await getSupportEmail();
  const now = new Date();

  // Lockout check (per-email, regardless of whether the email exists).
  const [attempt] = await db
    .select()
    .from(passwordResetAttemptsTable)
    .where(eq(passwordResetAttemptsTable.email, email));

  if (attempt?.lockedUntil && attempt.lockedUntil > now) {
    const minutesLeft = Math.ceil((attempt.lockedUntil.getTime() - now.getTime()) / 60000);
    res.status(429).json({
      error: `Too many failed attempts. Please try again in about ${minutesLeft} minutes, or contact ${supportEmail}.`,
      supportEmail,
    });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  const matches =
    !!user &&
    user.county.toLowerCase() === county.toLowerCase() &&
    user.serviceCategory.toLowerCase() === serviceCategory.toLowerCase();

  if (matches && user) {
    // Success: clear attempts, generate reset token, return URL.
    await db.delete(passwordResetAttemptsTable).where(eq(passwordResetAttemptsTable.email, email));

    const { token, tokenHash } = generateResetToken();
    const expires = new Date(Date.now() + 3600 * 1000);
    await db
      .update(usersTable)
      .set({ resetToken: tokenHash, resetExpires: expires })
      .where(eq(usersTable.id, user.id));

    req.log.info({ userId: user.id }, "Password reset verified via self-service");
    res.json({ success: true, token });
    return;
  }

  // Failure path: atomic upsert — sliding 1hr window + 3-strike lockout.
  // Done in a single SQL statement so concurrent failures cannot under-count.
  const windowMs = RESET_LOCKOUT_WINDOW_MS;
  const lockMs = RESET_LOCKOUT_DURATION_MS;
  const threshold = RESET_LOCKOUT_THRESHOLD;

  const result = await db.execute<{ attempts: number; locked_until: Date | null }>(sql`
    INSERT INTO password_reset_attempts (email, attempts, window_start, locked_until, updated_at)
    VALUES (${email}, 1, ${now}, NULL, ${now})
    ON CONFLICT (email) DO UPDATE SET
      attempts = CASE
        WHEN ${now}::timestamptz - password_reset_attempts.window_start < (${windowMs}::bigint || ' milliseconds')::interval
        THEN password_reset_attempts.attempts + 1
        ELSE 1
      END,
      window_start = CASE
        WHEN ${now}::timestamptz - password_reset_attempts.window_start < (${windowMs}::bigint || ' milliseconds')::interval
        THEN password_reset_attempts.window_start
        ELSE ${now}
      END,
      locked_until = CASE
        WHEN (CASE
                WHEN ${now}::timestamptz - password_reset_attempts.window_start < (${windowMs}::bigint || ' milliseconds')::interval
                THEN password_reset_attempts.attempts + 1
                ELSE 1
              END) >= ${threshold}
        THEN ${now}::timestamptz + (${lockMs}::bigint || ' milliseconds')::interval
        ELSE NULL
      END,
      updated_at = ${now}
    RETURNING attempts, locked_until
  `);

  const updated = result.rows?.[0] ?? null;
  const nextAttempts = Number(updated?.attempts ?? 1);
  const nextLockedUntil = updated?.locked_until ? new Date(updated.locked_until) : null;

  if (nextLockedUntil) {
    res.status(429).json({
      error: `Too many failed attempts. Please try again in about 60 minutes, or contact ${supportEmail}.`,
      supportEmail,
    });
    return;
  }

  // Generic error — never reveal whether the email exists.
  const remaining = Math.max(0, threshold - nextAttempts);
  res.status(401).json({
    error: `Those details don't match our records.${remaining > 0 ? ` You have ${remaining} ${remaining === 1 ? "try" : "tries"} left.` : ""} If you need help, contact ${supportEmail}.`,
    supportEmail,
  });
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { token, password } = parsed.data;

  const tokenHash = hashResetToken(token);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.resetToken, tokenHash));

  if (!user || !user.resetExpires || user.resetExpires < new Date()) {
    res.status(400).json({ error: "Invalid or expired reset token." });
    return;
  }

  const passwordHash = await hashPassword(password);
  await db.update(usersTable).set({ passwordHash, resetToken: null, resetExpires: null }).where(eq(usersTable.id, user.id));

  res.json({ success: true, message: "Password reset successfully." });
});

export default router;
