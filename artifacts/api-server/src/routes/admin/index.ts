import { Router, type IRouter } from "express";
import { db, usersTable, conversationMetadataTable, responseRatingsTable, feedbackTable, appConfigTable, tokenUsageTable } from "@workspace/db";
import { eq, count, avg, desc, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getActiveModel, getSpendThreshold, getCurrentMonthSpend } from "../../lib/tokenTracker";
import { ingestDocument } from "../../lib/rag";
import { UpdateAdminConfigBody } from "@workspace/api-zod";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

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
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(usersTable);

    const [{ newThisMonth }] = await db
      .select({ newThisMonth: count() })
      .from(usersTable)
      .where(sql`${usersTable.createdAt} >= ${startOfMonth}`);

    const [{ weeklyActive }] = await db
      .select({ weeklyActive: sql<number>`COUNT(DISTINCT ${conversationMetadataTable.userId})::int` })
      .from(conversationMetadataTable)
      .where(sql`${conversationMetadataTable.startedAt} >= ${weekAgo}`);

    const [{ unmatchedDomainsThisWeek }] = await db
      .select({ unmatchedDomainsThisWeek: count() })
      .from(usersTable)
      .where(and(eq(usersTable.domainMatch, false), sql`${usersTable.createdAt} >= ${weekAgo}`));

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

    const convCountsRaw = await db
      .select({ userId: conversationMetadataTable.userId, convCount: count() })
      .from(conversationMetadataTable)
      .groupBy(conversationMetadataTable.userId);

    const returningUsers = convCountsRaw.filter((r) => r.convCount > 1).length;
    const oneTimeUsers = convCountsRaw.filter((r) => r.convCount === 1).length;

    const taskLauncherUsageRaw = await db
      .select({ label: conversationMetadataTable.taskLauncherUsed, count: count() })
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
    const { spend: currentMonthSpend, tokens: currentMonthTokens } = await getCurrentMonthSpend();

    res.json({
      totalUsers,
      newThisMonth,
      weeklyActive,
      unmatchedDomainsThisWeek,
      returningUsers,
      oneTimeUsers,
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
      currentMonthTokens,
      activeModel,
      spendThreshold,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin stats");
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  try {
    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        county: usersTable.county,
        serviceCategory: usersTable.serviceCategory,
        domainMatch: usersTable.domainMatch,
        domainNote: usersTable.domainNote,
        disabled: usersTable.disabled,
        createdAt: usersTable.createdAt,
        lastActive: usersTable.lastActive,
        conversationCount: sql<number>`(SELECT COUNT(*) FROM conversation_metadata WHERE conversation_metadata.user_id = ${usersTable.id})::int`,
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
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin users");
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.patch("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { disabled } = req.body;
    if (typeof disabled !== "boolean") {
      res.status(400).json({ error: "disabled must be a boolean" });
      return;
    }
    await db.update(usersTable).set({ disabled }).where(eq(usersTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update user status");
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.get("/admin/feedback", requireAdmin, async (req, res): Promise<void> => {
  try {
    const entries = await db
      .select({
        id: feedbackTable.id,
        userId: feedbackTable.userId,
        userEmail: usersTable.email,
        feedbackType: feedbackTable.feedbackType,
        detail: feedbackTable.detail,
        attemptedFileSize: feedbackTable.attemptedFileSize,
        createdAt: feedbackTable.createdAt,
      })
      .from(feedbackTable)
      .leftJoin(usersTable, eq(feedbackTable.userId, usersTable.id))
      .orderBy(desc(feedbackTable.createdAt))
      .limit(200);

    res.json(
      entries.map((e) => ({
        id: e.id,
        userId: e.userId,
        userEmail: e.userEmail ?? "unknown",
        feedbackType: e.feedbackType,
        detail: e.detail ?? null,
        attemptedFileSize: e.attemptedFileSize ?? null,
        createdAt: e.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin feedback");
    res.status(500).json({ error: "Failed to fetch feedback" });
  }
});

router.get("/admin/corpus", requireAdmin, async (req, res): Promise<void> => {
  try {
    const rows = await db.execute(sql`
      SELECT doc_id, COUNT(*)::int AS chunk_count, MAX(created_at) AS last_updated
      FROM corpus_chunks
      GROUP BY doc_id
      ORDER BY doc_id
    `);
    res.json(
      (rows.rows as Array<{ doc_id: string; chunk_count: number; last_updated: string }>).map((r) => ({
        docId: r.doc_id,
        chunkCount: r.chunk_count,
        lastUpdated: r.last_updated,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to fetch corpus");
    res.status(500).json({ error: "Failed to fetch corpus" });
  }
});

router.post("/admin/corpus", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { docId, content } = req.body;
    if (!docId || typeof docId !== "string" || !content || typeof content !== "string") {
      res.status(400).json({ error: "docId and content are required strings" });
      return;
    }
    const existing = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM corpus_chunks WHERE doc_id = ${docId}`);
    if (Number((existing.rows[0] as any)?.cnt) > 0) {
      res.status(409).json({ error: "Document already exists. Use PUT to replace it." });
      return;
    }
    await ingestDocument(docId, content);
    res.status(201).json({ success: true, docId });
  } catch (err) {
    req.log.error({ err }, "Failed to ingest corpus document");
    res.status(500).json({ error: "Failed to ingest document" });
  }
});

router.put("/admin/corpus/:docId", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { docId } = req.params;
    const { content } = req.body;
    if (!content || typeof content !== "string") {
      res.status(400).json({ error: "content is required" });
      return;
    }
    await ingestDocument(docId, content);
    res.json({ success: true, docId });
  } catch (err) {
    req.log.error({ err }, "Failed to replace corpus document");
    res.status(500).json({ error: "Failed to replace document" });
  }
});

router.delete("/admin/corpus/:docId", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { docId } = req.params;
    await db.execute(sql`DELETE FROM corpus_chunks WHERE doc_id = ${docId}`);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete corpus document");
    res.status(500).json({ error: "Failed to delete document" });
  }
});

router.get("/admin/config", requireAdmin, async (req, res): Promise<void> => {
  const activeModel = await getActiveModel();
  const spendThreshold = await getSpendThreshold();
  const { spend, tokens } = await getCurrentMonthSpend();
  res.json({ activeModel, spendThreshold, currentMonthSpend: spend, currentMonthTokens: tokens });
});

router.patch("/admin/config", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateAdminConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { activeModel, spendThreshold } = parsed.data;
  if (activeModel != null) {
    await db.insert(appConfigTable).values({ key: "active_model", value: activeModel })
      .onConflictDoUpdate({ target: appConfigTable.key, set: { value: activeModel, updatedAt: new Date() } });
  }
  if (spendThreshold != null) {
    await db.insert(appConfigTable).values({ key: "spend_threshold", value: String(spendThreshold) })
      .onConflictDoUpdate({ target: appConfigTable.key, set: { value: String(spendThreshold), updatedAt: new Date() } });
  }
  const updatedModel = await getActiveModel();
  const updatedThreshold = await getSpendThreshold();
  const { spend, tokens } = await getCurrentMonthSpend();
  res.json({ activeModel: updatedModel, spendThreshold: updatedThreshold, currentMonthSpend: spend, currentMonthTokens: tokens });
});

export default router;
