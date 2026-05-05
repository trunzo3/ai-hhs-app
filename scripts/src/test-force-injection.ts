import { db, taskLauncherCardsTable, conversationMetadataTable, usersTable, retrievalDebugLogTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { getAllChunksForDocs, retrieveRelevantChunksWithScores, type RetrievedChunk } from "../../artifacts/api-server/src/lib/rag";
import { buildSystemPromptFromDB } from "../../artifacts/api-server/src/lib/systemPrompt";
import { setDebugRetrievalLogging, getDebugRetrievalLogging } from "../../artifacts/api-server/src/lib/appConfig";

function header(s: string) { console.log("\n=== " + s + " ==="); }
function ok(cond: boolean, label: string) {
  console.log((cond ? "PASS  " : "FAIL  ") + label);
  if (!cond) process.exitCode = 1;
}

const FORCED_DOC = "riceco_corpus_v20260423a";          // 10 chunks
const SECOND_FORCED = "aidn-feedback-model_v20260423c"; // 15 chunks

async function main() {
  header("Setup: pick test card and force-inject RICECO + AIDN docs");
  const [card] = await db.select().from(taskLauncherCardsTable)
    .where(eq(taskLauncherCardsTable.title, "Prepare to deliver feedback"));
  if (!card) throw new Error("Test card not found");

  await db.update(taskLauncherCardsTable)
    .set({
      corpusDocIds: [FORCED_DOC, SECOND_FORCED],
      taskChainPrompt: "Coach the user through a feedback prep using the AIDN model.",
    })
    .where(eq(taskLauncherCardsTable.id, card.id));
  console.log("Card:", card.id, card.title);

  header("Test 1: getAllChunksForDocs returns ALL chunks for given docs");
  const forced = await getAllChunksForDocs([FORCED_DOC, SECOND_FORCED]);
  console.log("Forced chunks fetched:", forced.length);
  const counts: Record<string, number> = {};
  for (const c of forced) counts[c.docId] = (counts[c.docId] ?? 0) + 1;
  console.log("Per-doc counts:", counts);
  ok(counts[FORCED_DOC] === 10, `RICECO has 10 forced chunks (got ${counts[FORCED_DOC]})`);
  ok(counts[SECOND_FORCED] === 15, `AIDN has 15 forced chunks (got ${counts[SECOND_FORCED]})`);
  ok(forced.every((c) => c.score === 1), "All forced chunks tagged score=1");

  header("Test 2: RAG search excludes forced docIds (no duplicates)");
  const ragNoExclude = await retrieveRelevantChunksWithScores("How should I structure feedback to my staff?", 3, []);
  const ragExcluded  = await retrieveRelevantChunksWithScores("How should I structure feedback to my staff?", 3, [FORCED_DOC, SECOND_FORCED]);
  console.log("RAG (no exclude) docIds:", ragNoExclude.map((r) => r.docId));
  console.log("RAG (excluded) docIds:  ", ragExcluded.map((r) => r.docId));
  ok(ragExcluded.every((c) => c.docId !== FORCED_DOC && c.docId !== SECOND_FORCED),
     "Excluded docs do NOT appear in RAG results");
  ok(ragExcluded.length === 3, "Still returns 3 RAG chunks after exclusion");

  header("Test 3: System prompt places forced chunks first in Layer 3");
  const ragChunks = ragExcluded;
  const ragContext = [...forced, ...ragChunks].map((c) => c.content);
  const prompt = await buildSystemPromptFromDB({
    ragContext,
    county: "Alameda",
    serviceCategory: "Child Welfare",
    workingOutsideArea: false,
    taskLauncher: card.title,
    taskChainPrompt: "Coach the user through a feedback prep using the AIDN model.",
  });
  const firstForcedSnippet = forced[0].content.slice(0, 60);
  const firstRagSnippet = ragChunks[0].content.slice(0, 60);
  const idxForced = prompt.indexOf(firstForcedSnippet);
  const idxRag = prompt.indexOf(firstRagSnippet);
  console.log("idx forced[0] =", idxForced, " idx rag[0] =", idxRag);
  ok(idxForced > -1 && idxRag > -1, "Both forced and RAG content present in prompt");
  ok(idxForced < idxRag, "Forced chunks appear BEFORE RAG chunks in Layer 3");
  ok(prompt.includes("REFERENCE MATERIAL"), "Layer 3 preamble present");
  ok(prompt.includes("Coach the user through a feedback prep"), "Task chain prompt appended");

  header("Test 4: Card binding survives in conversation_metadata for re-read");
  const [user] = await db.select().from(usersTable).limit(1);
  if (!user) throw new Error("No users in DB to bind a conversation");
  const [conv] = await db.insert(conversationMetadataTable).values({
    userId: user.id, taskLauncherUsed: card.title, taskLauncherCardId: card.id,
  }).returning();
  console.log("Created conversation:", conv.id);
  // Simulate "every turn re-reads card by UUID"
  const [reReadMeta] = await db.select({ cardId: conversationMetadataTable.taskLauncherCardId })
    .from(conversationMetadataTable).where(eq(conversationMetadataTable.id, conv.id));
  ok(reReadMeta.cardId === card.id, "Conversation re-reads same card UUID across turns");
  const [reReadCard] = await db.select().from(taskLauncherCardsTable).where(eq(taskLauncherCardsTable.id, reReadMeta.cardId!));
  ok(Array.isArray(reReadCard.corpusDocIds) && reReadCard.corpusDocIds!.length === 2,
     "Re-read card still has corpusDocIds set (force-inject persists every turn)");

  header("Test 5: Edits to corpusDocIds take effect on next turn (no rebind)");
  await db.update(taskLauncherCardsTable)
    .set({ corpusDocIds: [SECOND_FORCED] })
    .where(eq(taskLauncherCardsTable.id, card.id));
  const [reReadCard2] = await db.select().from(taskLauncherCardsTable).where(eq(taskLauncherCardsTable.id, card.id));
  ok(reReadCard2.corpusDocIds!.length === 1 && reReadCard2.corpusDocIds![0] === SECOND_FORCED,
     "Updated corpusDocIds reflected on next turn's re-read");

  header("Test 6: Debug logging captures forced vs rag source labels");
  await setDebugRetrievalLogging(true);
  ok(await getDebugRetrievalLogging() === true, "Debug logging toggle ON");
  const tagged = [
    ...forced.map((c) => ({ docId: c.docId, title: c.title, score: c.score, source: "forced" as const, preview: c.content.slice(0, 280) })),
    ...ragChunks.map((c) => ({ docId: c.docId, title: c.title, score: c.score, source: "rag" as const, preview: c.content.slice(0, 280) })),
  ];
  const [logRow] = await db.insert(retrievalDebugLogTable).values({
    conversationId: conv.id, userId: user.id, userEmail: user.email,
    query: "test query for force-injection e2e", chunks: tagged,
  }).returning();
  console.log("Inserted debug log:", logRow.id);
  const [readBack] = await db.select().from(retrievalDebugLogTable).where(eq(retrievalDebugLogTable.id, logRow.id));
  const chunksBack = readBack.chunks as Array<{ source: string; docId: string }>;
  const forcedCount = chunksBack.filter((c) => c.source === "forced").length;
  const ragCount = chunksBack.filter((c) => c.source === "rag").length;
  ok(forcedCount === forced.length, `Debug log preserves ${forced.length} forced entries (got ${forcedCount})`);
  ok(ragCount === ragChunks.length, `Debug log preserves ${ragChunks.length} rag entries (got ${ragCount})`);

  header("Cleanup");
  await db.delete(retrievalDebugLogTable).where(eq(retrievalDebugLogTable.id, logRow.id));
  await db.delete(conversationMetadataTable).where(eq(conversationMetadataTable.id, conv.id));
  await db.update(taskLauncherCardsTable)
    .set({ corpusDocIds: null, taskChainPrompt: null })
    .where(eq(taskLauncherCardsTable.id, card.id));
  await setDebugRetrievalLogging(false);
  console.log("Cleanup done.");

  header("Summary");
  console.log(process.exitCode ? "FAILURES detected (see above)." : "All assertions passed.");
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
