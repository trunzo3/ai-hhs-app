import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, checkDomainMatch, generateResetToken } from "../../lib/auth";
import {
  RegisterBody,
  LoginBody,
  ForgotPasswordBody,
  ResetPasswordBody,
} from "@workspace/api-zod";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

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

router.post("/auth/logout", async (req, res): Promise<void> => {
  req.session.destroy(() => {});
  res.json({ success: true, message: "Logged out" });
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

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));

  if (user) {
    const token = generateResetToken();
    const expires = new Date(Date.now() + 3600 * 1000);
    await db.update(usersTable).set({ resetToken: token, resetExpires: expires }).where(eq(usersTable.id, user.id));
    req.log.info({ userId: user.id }, "Password reset requested");
  }

  res.json({ success: true, message: "If an account with that email exists, a reset link has been sent." });
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { token, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.resetToken, token));

  if (!user || !user.resetExpires || user.resetExpires < new Date()) {
    res.status(400).json({ error: "Invalid or expired reset token." });
    return;
  }

  const passwordHash = await hashPassword(password);
  await db.update(usersTable).set({ passwordHash, resetToken: null, resetExpires: null }).where(eq(usersTable.id, user.id));

  res.json({ success: true, message: "Password reset successfully." });
});

export default router;
