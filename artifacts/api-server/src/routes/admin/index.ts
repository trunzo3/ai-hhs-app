import { Router, type IRouter } from "express";
import { db, usersTable, conversationMetadataTable, responseRatingsTable, feedbackTable, appConfigTable, tokenUsageTable, corpusDocumentsTable, systemPromptsTable } from "@workspace/db";
import { eq, count, avg, desc, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getActiveModel, getSpendThreshold, getCurrentMonthSpend } from "../../lib/tokenTracker";
import { ingestDocument } from "../../lib/rag";
import { invalidateSystemPromptCache, LAYER_1_IDENTITY, LAYER_2_METHODOLOGY, LAYER_3_RAG_PREAMBLE, LAYER_4_USER_CONTEXT } from "../../lib/systemPrompt";
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
    const [{ newThisMonth }] = await db.select({ newThisMonth: count() }).from(usersTable).where(sql`${usersTable.createdAt} >= ${startOfMonth}`);
    const [{ weeklyActive }] = await db.select({ weeklyActive: sql<number>`COUNT(DISTINCT ${conversationMetadataTable.userId})::int` }).from(conversationMetadataTable).where(sql`${conversationMetadataTable.startedAt} >= ${weekAgo}`);
    const [{ unmatchedDomainsThisWeek }] = await db.select({ unmatchedDomainsThisWeek: count() }).from(usersTable).where(and(eq(usersTable.domainMatch, false), sql`${usersTable.createdAt} >= ${weekAgo}`));

    const usersByCounty = await db.select({ label: usersTable.county, count: sql<number>`COUNT(*)::int` }).from(usersTable).groupBy(usersTable.county).orderBy(sql`COUNT(*) DESC`);
    const usersByServiceCategory = await db.select({ label: usersTable.serviceCategory, count: sql<number>`COUNT(*)::int` }).from(usersTable).groupBy(usersTable.serviceCategory).orderBy(sql`COUNT(*) DESC`);
    const [{ unmatchedDomainCount }] = await db.select({ unmatchedDomainCount: count() }).from(usersTable).where(eq(usersTable.domainMatch, false));
    const [{ totalConversations }] = await db.select({ totalConversations: count() }).from(conversationMetadataTable);
    const [{ avgMessages }] = await db.select({ avgMessages: avg(conversationMetadataTable.messageCount) }).from(conversationMetadataTable);

    const convCountsRaw = await db.select({ userId: conversationMetadataTable.userId, convCount: count() }).from(conversationMetadataTable).groupBy(conversationMetadataTable.userId);
    const returningUsers = convCountsRaw.filter((r) => r.convCount > 1).length;
    const oneTimeUsers = convCountsRaw.filter((r) => r.convCount === 1).length;

    const taskLauncherUsageRaw = await db.select({ label: conversationMetadataTable.taskLauncherUsed, count: count() }).from(conversationMetadataTable).where(sql`${conversationMetadataTable.taskLauncherUsed} IS NOT NULL`).groupBy(conversationMetadataTable.taskLauncherUsed).orderBy(desc(count()));
    const taskLauncherUsage = taskLauncherUsageRaw.map((r) => ({ label: r.label ?? "Unknown", count: r.count }));

    const [{ thumbsUpCount }] = await db.select({ thumbsUpCount: count() }).from(responseRatingsTable).where(eq(responseRatingsTable.rating, "up"));
    const [{ thumbsDownCount }] = await db.select({ thumbsDownCount: count() }).from(responseRatingsTable).where(eq(responseRatingsTable.rating, "down"));

    const activeModel = await getActiveModel();
    const spendThreshold = await getSpendThreshold();
    const { spend: currentMonthSpend, tokens: currentMonthTokens } = await getCurrentMonthSpend();

    res.json({
      totalUsers, newThisMonth, weeklyActive, unmatchedDomainsThisWeek, returningUsers, oneTimeUsers,
      usersByCounty, usersByServiceCategory, unmatchedDomainCount, totalConversations,
      avgMessagesPerConversation: parseFloat(avgMessages ?? "0") || 0,
      taskLauncherUsage, thumbsUpCount, thumbsDownCount,
      currentMonthSpend, currentMonthTokens, activeModel, spendThreshold,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin stats");
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  try {
    const users = await db.select({
      id: usersTable.id, email: usersTable.email, county: usersTable.county, serviceCategory: usersTable.serviceCategory,
      domainMatch: usersTable.domainMatch, domainNote: usersTable.domainNote, disabled: usersTable.disabled,
      createdAt: usersTable.createdAt, lastActive: usersTable.lastActive,
      conversationCount: sql<number>`(SELECT COUNT(*) FROM conversation_metadata WHERE conversation_metadata.user_id = ${usersTable.id})::int`,
    }).from(usersTable).orderBy(desc(usersTable.createdAt));
    res.json(users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString(), lastActive: u.lastActive?.toISOString() ?? null })));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin users");
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.patch("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { disabled } = req.body;
    if (typeof disabled !== "boolean") { res.status(400).json({ error: "disabled must be a boolean" }); return; }
    await db.update(usersTable).set({ disabled }).where(eq(usersTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update user status");
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.get("/admin/feedback", requireAdmin, async (req, res): Promise<void> => {
  try {
    const entries = await db.select({
      id: feedbackTable.id, userId: feedbackTable.userId, userEmail: usersTable.email,
      feedbackType: feedbackTable.feedbackType, detail: feedbackTable.detail,
      attemptedFileSize: feedbackTable.attemptedFileSize, createdAt: feedbackTable.createdAt,
    }).from(feedbackTable).leftJoin(usersTable, eq(feedbackTable.userId, usersTable.id)).orderBy(desc(feedbackTable.createdAt)).limit(200);
    res.json(entries.map((e) => {
      const email = e.userEmail ?? "unknown";
      const domain = email.includes("@") ? email.split("@")[1] : "—";
      return { ...e, userEmail: email, domain, detail: e.detail ?? null, attemptedFileSize: e.attemptedFileSize ?? null, createdAt: e.createdAt.toISOString() };
    }));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin feedback");
    res.status(500).json({ error: "Failed to fetch feedback" });
  }
});

async function seedCorpusDocumentMeta(): Promise<void> {
  try {
    const orphans = await db.execute(sql`
      SELECT DISTINCT cc.doc_id FROM corpus_chunks cc
      LEFT JOIN corpus_documents cd ON cc.doc_id = cd.doc_id
      WHERE cd.doc_id IS NULL
    `);
    for (const row of orphans.rows as Array<{ doc_id: string }>) {
      const title = row.doc_id.split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      await db.insert(corpusDocumentsTable).values({ docId: row.doc_id, title, description: "", category: "Methodology" }).onConflictDoNothing();
    }
  } catch (err) {
    logger.warn({ err }, "Failed to seed corpus document metadata");
  }
}

router.get("/admin/corpus", requireAdmin, async (req, res): Promise<void> => {
  try {
    await seedCorpusDocumentMeta();
    const rows = await db.execute(sql`
      SELECT cd.doc_id, cd.title, cd.description, cd.category, cd.created_at,
             COUNT(cc.id)::int AS chunk_count,
             MAX(cc.created_at) AS last_updated
      FROM corpus_documents cd
      LEFT JOIN corpus_chunks cc ON cc.doc_id = cd.doc_id
      GROUP BY cd.doc_id, cd.title, cd.description, cd.category, cd.created_at
      ORDER BY cd.title
    `);
    res.json((rows.rows as any[]).map((r) => ({
      docId: r.doc_id, title: r.title, description: r.description, category: r.category,
      createdAt: r.created_at, chunkCount: r.chunk_count, lastUpdated: r.last_updated,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch corpus");
    res.status(500).json({ error: "Failed to fetch corpus" });
  }
});

router.get("/admin/corpus/:docId/content", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { docId } = req.params;
    const chunks = await db.execute(sql`SELECT content FROM corpus_chunks WHERE doc_id = ${docId} ORDER BY chunk_index ASC`);
    const content = (chunks.rows as Array<{ content: string }>).map((r) => r.content).join("\n\n---\n\n");
    res.json({ docId, content });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch corpus content");
    res.status(500).json({ error: "Failed to fetch document content" });
  }
});

router.post("/admin/corpus", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { docId, title, description, category, content } = req.body;
    if (!docId || !title || !content) { res.status(400).json({ error: "docId, title, and content are required" }); return; }
    const existing = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM corpus_chunks WHERE doc_id = ${docId}`);
    if (Number((existing.rows[0] as any)?.cnt) > 0) { res.status(409).json({ error: "Document already exists. Use PUT to replace it." }); return; }
    await ingestDocument(docId, content);
    await db.insert(corpusDocumentsTable).values({ docId, title: title ?? docId, description: description ?? "", category: category ?? "Methodology" }).onConflictDoUpdate({ target: corpusDocumentsTable.docId, set: { title: title ?? docId, description: description ?? "", category: category ?? "Methodology", updatedAt: new Date() } });
    res.status(201).json({ success: true, docId });
  } catch (err) {
    req.log.error({ err }, "Failed to ingest corpus document");
    res.status(500).json({ error: "Failed to ingest document" });
  }
});

router.put("/admin/corpus/:docId", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { docId } = req.params;
    const { content, title, description, category } = req.body;
    if (!content) { res.status(400).json({ error: "content is required" }); return; }
    await ingestDocument(docId, content);
    const update: any = { updatedAt: new Date() };
    if (title) update.title = title;
    if (description !== undefined) update.description = description;
    if (category) update.category = category;
    await db.update(corpusDocumentsTable).set(update).where(eq(corpusDocumentsTable.docId, docId));
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
    await db.delete(corpusDocumentsTable).where(eq(corpusDocumentsTable.docId, docId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete corpus document");
    res.status(500).json({ error: "Failed to delete document" });
  }
});

router.get("/admin/system-prompt", requireAdmin, async (req, res): Promise<void> => {
  try {
    const seeds = [
      { layer: 1, content: LAYER_1_IDENTITY },
      { layer: 2, content: LAYER_2_METHODOLOGY },
      { layer: 3, content: LAYER_3_RAG_PREAMBLE },
      { layer: 4, content: LAYER_4_USER_CONTEXT },
    ];
    const existing = await db.select().from(systemPromptsTable);
    const existingSet = new Set(existing.map((r) => r.layer));
    for (const s of seeds) {
      if (!existingSet.has(s.layer)) {
        await db.insert(systemPromptsTable).values(s).onConflictDoNothing();
      }
    }
    const allLayers = existingSet.size >= 4 ? existing : await db.select().from(systemPromptsTable);
    res.json(allLayers.map((l) => ({ layer: l.layer, content: l.content, previousContent: l.previousContent, updatedAt: l.updatedAt?.toISOString() ?? null })));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch system prompts");
    res.status(500).json({ error: "Failed to fetch system prompts" });
  }
});

router.put("/admin/system-prompt/:layer", requireAdmin, async (req, res): Promise<void> => {
  try {
    const layer = parseInt(req.params.layer, 10);
    if (isNaN(layer) || layer < 1 || layer > 4) { res.status(400).json({ error: "layer must be 1–4" }); return; }
    const { content } = req.body;
    if (!content || typeof content !== "string") { res.status(400).json({ error: "content is required" }); return; }
    const [existing] = await db.select().from(systemPromptsTable).where(eq(systemPromptsTable.layer, layer));
    const previousContent = existing?.content ?? null;
    await db.insert(systemPromptsTable)
      .values({ layer, content, previousContent, updatedAt: new Date() })
      .onConflictDoUpdate({ target: systemPromptsTable.layer, set: { content, previousContent, updatedAt: new Date() } });
    invalidateSystemPromptCache();
    const [updated] = await db.select().from(systemPromptsTable).where(eq(systemPromptsTable.layer, layer));
    res.json({ layer: updated.layer, content: updated.content, previousContent: updated.previousContent, updatedAt: updated.updatedAt?.toISOString() ?? null });
  } catch (err) {
    req.log.error({ err }, "Failed to update system prompt");
    res.status(500).json({ error: "Failed to update system prompt" });
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
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { activeModel, spendThreshold } = parsed.data;
  if (activeModel != null) {
    await db.insert(appConfigTable).values({ key: "active_model", value: activeModel }).onConflictDoUpdate({ target: appConfigTable.key, set: { value: activeModel, updatedAt: new Date() } });
  }
  if (spendThreshold != null) {
    await db.insert(appConfigTable).values({ key: "spend_threshold", value: String(spendThreshold) }).onConflictDoUpdate({ target: appConfigTable.key, set: { value: String(spendThreshold), updatedAt: new Date() } });
  }
  const updatedModel = await getActiveModel();
  const updatedThreshold = await getSpendThreshold();
  const { spend, tokens } = await getCurrentMonthSpend();
  res.json({ activeModel: updatedModel, spendThreshold: updatedThreshold, currentMonthSpend: spend, currentMonthTokens: tokens });
});

router.get("/admin/trends", requireAdmin, async (req, res): Promise<void> => {
  try {
    const NUM_WEEKS = 10;
    const weeklyActive: number[] = [];
    const weeklyConversations: number[] = [];
    const weeklyThumbsUpPct: (number | null)[] = [];

    for (let i = NUM_WEEKS - 1; i >= 0; i--) {
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 7);

      const [{ active }] = await db.select({ active: sql<number>`COUNT(DISTINCT ${conversationMetadataTable.userId})::int` })
        .from(conversationMetadataTable)
        .where(and(sql`${conversationMetadataTable.startedAt} >= ${weekStart}`, sql`${conversationMetadataTable.startedAt} < ${weekEnd}`));

      const [{ convos }] = await db.select({ convos: sql<number>`COUNT(*)::int` })
        .from(conversationMetadataTable)
        .where(and(sql`${conversationMetadataTable.startedAt} >= ${weekStart}`, sql`${conversationMetadataTable.startedAt} < ${weekEnd}`));

      const [{ ups }] = await db.select({ ups: sql<number>`COUNT(*)::int` })
        .from(responseRatingsTable)
        .where(and(eq(responseRatingsTable.rating, "up"), sql`${responseRatingsTable.createdAt} >= ${weekStart}`, sql`${responseRatingsTable.createdAt} < ${weekEnd}`));

      const [{ total }] = await db.select({ total: sql<number>`COUNT(*)::int` })
        .from(responseRatingsTable)
        .where(and(sql`${responseRatingsTable.createdAt} >= ${weekStart}`, sql`${responseRatingsTable.createdAt} < ${weekEnd}`));

      weeklyActive.push(active ?? 0);
      weeklyConversations.push(convos ?? 0);
      weeklyThumbsUpPct.push(total > 0 ? Math.round(((ups ?? 0) / total) * 100) : null);
    }

    res.json({ weeklyActive, weeklyConversations, weeklyThumbsUpPct });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch trends");
    res.status(500).json({ error: "Failed to fetch trends" });
  }
});

export default router;
