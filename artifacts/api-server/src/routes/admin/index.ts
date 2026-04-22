import { Router, type IRouter } from "express";
import { db, usersTable, conversationMetadataTable, responseRatingsTable, feedbackTable, appConfigTable, tokenUsageTable } from "@workspace/db";
import { eq, count, avg, sum, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getActiveModel, getSpendThreshold, getCurrentMonth, getCurrentMonthSpend } from "../../lib/tokenTracker";
import { UpdateAdminConfigBody } from "@workspace/api-zod";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

const ADMIN_EMAIL = "anthony@iqmeeteq.com";
const ADMIN_PASSWORD = "95682";

function requireAdmin(req: any, res: any, next: any): void {
  const authHeader = req.headers["x-admin-auth"];
  if (authHeader !== "authenticated") {
    res.status(401).json({ error: "Admin authentication required" });
    return;
  }
  next();
}

router.get("/admin/stats", requireAdmin, async (req, res): Promise<void> => {
  try {
    const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(usersTable);

    const usersByCounty = await db
      .select({ label: usersTable.county, count: count() })
      .from(usersTable)
      .groupBy(usersTable.county)
      .orderBy(desc(count()));

    const usersByServiceCategory = await db
      .select({ label: usersTable.serviceCategory, count: count() })
      .from(usersTable)
      .groupBy(usersTable.serviceCategory)
      .orderBy(desc(count()));

    const [{ unmatchedDomainCount }] = await db
      .select({ unmatchedDomainCount: count() })
      .from(usersTable)
      .where(eq(usersTable.domainMatch, false));

    const [{ totalConversations }] = await db
      .select({ totalConversations: count() })
      .from(conversationMetadataTable);

    const [{ avgMessages }] = await db
      .select({ avgMessages: avg(conversationMetadataTable.messageCount) })
      .from(conversationMetadataTable);

    const taskLauncherUsageRaw = await db
      .select({
        label: conversationMetadataTable.taskLauncherUsed,
        count: count(),
      })
      .from(conversationMetadataTable)
      .where(sql`${conversationMetadataTable.taskLauncherUsed} IS NOT NULL`)
      .groupBy(conversationMetadataTable.taskLauncherUsed)
      .orderBy(desc(count()));

    const taskLauncherUsage = taskLauncherUsageRaw.map((r) => ({
      label: r.label ?? "Unknown",
      count: r.count,
    }));

    const [{ thumbsUpCount }] = await db
      .select({ thumbsUpCount: count() })
      .from(responseRatingsTable)
      .where(eq(responseRatingsTable.rating, "up"));

    const [{ thumbsDownCount }] = await db
      .select({ thumbsDownCount: count() })
      .from(responseRatingsTable)
      .where(eq(responseRatingsTable.rating, "down"));

    const [{ feedbackCount }] = await db
      .select({ feedbackCount: count() })
      .from(feedbackTable);

    const activeModel = await getActiveModel();
    const spendThreshold = await getSpendThreshold();
    const { spend: currentMonthSpend } = await getCurrentMonthSpend();

    const recentActivityRaw = await db
      .select({
        county: usersTable.county,
        lastActivity: sql<string>`MAX(${usersTable.lastActive})`,
        userCount: count(),
      })
      .from(usersTable)
      .groupBy(usersTable.county)
      .orderBy(desc(sql`MAX(${usersTable.lastActive})`))
      .limit(10);

    const recentActivityByCounty = recentActivityRaw.map((r) => ({
      county: r.county,
      lastActivity: r.lastActivity ?? new Date().toISOString(),
      userCount: r.userCount,
    }));

    res.json({
      totalUsers,
      usersByCounty,
      usersByServiceCategory,
      unmatchedDomainCount,
      totalConversations,
      avgMessagesPerConversation: parseFloat(avgMessages ?? "0") || 0,
      taskLauncherUsage,
      thumbsUpCount,
      thumbsDownCount,
      feedbackCount,
      currentMonthSpend,
      activeModel,
      spendThreshold,
      recentActivityByCounty,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin stats");
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const users = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      county: usersTable.county,
      serviceCategory: usersTable.serviceCategory,
      domainMatch: usersTable.domainMatch,
      domainNote: usersTable.domainNote,
      createdAt: usersTable.createdAt,
      lastActive: usersTable.lastActive,
    })
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt));

  res.json(
    users.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
      lastActive: u.lastActive?.toISOString() ?? null,
    }))
  );
});

router.get("/admin/feedback", requireAdmin, async (req, res): Promise<void> => {
  const entries = await db
    .select()
    .from(feedbackTable)
    .orderBy(desc(feedbackTable.createdAt))
    .limit(100);

  res.json(
    entries.map((e) => ({
      id: e.id,
      userId: e.userId,
      feedbackType: e.feedbackType,
      detail: e.detail ?? null,
      attemptedFileSize: e.attemptedFileSize ?? null,
      createdAt: e.createdAt.toISOString(),
    }))
  );
});

router.get("/admin/config", requireAdmin, async (req, res): Promise<void> => {
  const activeModel = await getActiveModel();
  const spendThreshold = await getSpendThreshold();
  const { spend, tokens } = await getCurrentMonthSpend();

  res.json({
    activeModel,
    spendThreshold,
    currentMonthSpend: spend,
    currentMonthTokens: tokens,
  });
});

router.patch("/admin/config", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateAdminConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { activeModel, spendThreshold } = parsed.data;

  if (activeModel != null) {
    await db
      .insert(appConfigTable)
      .values({ key: "active_model", value: activeModel })
      .onConflictDoUpdate({
        target: appConfigTable.key,
        set: { value: activeModel, updatedAt: new Date() },
      });
  }

  if (spendThreshold != null) {
    await db
      .insert(appConfigTable)
      .values({ key: "spend_threshold", value: String(spendThreshold) })
      .onConflictDoUpdate({
        target: appConfigTable.key,
        set: { value: String(spendThreshold), updatedAt: new Date() },
      });
  }

  const updatedModel = await getActiveModel();
  const updatedThreshold = await getSpendThreshold();
  const { spend, tokens } = await getCurrentMonthSpend();

  res.json({
    activeModel: updatedModel,
    spendThreshold: updatedThreshold,
    currentMonthSpend: spend,
    currentMonthTokens: tokens,
  });
});

export default router;
