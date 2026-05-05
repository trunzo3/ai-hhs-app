import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const MAX_CHUNKS = 3;

let _extractor: any = null;

async function getExtractor() {
  if (!_extractor) {
    logger.info("Loading local embedding model...");
    const { pipeline } = await import("@xenova/transformers");
    _extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    logger.info("Embedding model loaded");
  }
  return _extractor;
}

export async function embedText(text: string): Promise<number[]> {
  try {
    const extractor = await getExtractor();
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data) as number[];
  } catch (err) {
    logger.error({ err }, "Failed to embed text");
    return [];
  }
}

export type RetrievedChunk = {
  docId: string;
  title: string;
  content: string;
  score: number;
};

/**
 * Retrieves top-K chunks with similarity scores. Score is cosine similarity
 * in [0, 1] (1 = identical), derived from pgvector's `<=>` cosine-distance
 * operator as `1 - distance`.
 */
export async function retrieveRelevantChunksWithScores(
  query: string,
  k: number = MAX_CHUNKS,
  excludeDocIds: string[] = [],
): Promise<RetrievedChunk[]> {
  const limit = Math.max(1, Math.min(20, k));
  try {
    const embedding = await embedText(query);
    if (embedding.length === 0) return [];

    const embeddingStr = `[${embedding.join(",")}]`;

    const toPgArray = (arr: string[]) =>
      `{${arr.map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

    const excludeClause = excludeDocIds.length > 0
      ? sql`WHERE cc.doc_id <> ALL(${toPgArray(excludeDocIds)}::text[])`
      : sql``;

    const results = await db.execute(sql`
      SELECT cc.content, cc.doc_id, cd.title,
             (1 - (cc.embedding <=> ${embeddingStr}::vector)) AS score
      FROM corpus_chunks cc
      LEFT JOIN corpus_documents cd ON cd.doc_id = cc.doc_id
      ${excludeClause}
      ORDER BY cc.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `);

    return (results.rows as Array<{ content: string; doc_id: string; title: string | null; score: number | string }>)
      .map((r) => ({
        docId: r.doc_id,
        title: r.title ?? r.doc_id,
        content: r.content,
        score: typeof r.score === "string" ? parseFloat(r.score) : r.score,
      }));
  } catch (err) {
    logger.warn({ err }, "RAG retrieval failed, continuing without context");
    return [];
  }
}

/**
 * Fetch ALL chunks for the given document IDs, ordered by docId then chunk_index.
 * Used to force-inject specific corpus docs into context (bypasses similarity search).
 * Score is set to 1.0 to mark these as guaranteed-injected for debug logging.
 */
export async function getAllChunksForDocs(docIds: string[]): Promise<RetrievedChunk[]> {
  if (docIds.length === 0) return [];
  try {
    const docIdsLiteral = `{${docIds.map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
    const results = await db.execute(sql`
      SELECT cc.content, cc.doc_id, cd.title, cc.chunk_index
      FROM corpus_chunks cc
      LEFT JOIN corpus_documents cd ON cd.doc_id = cc.doc_id
      WHERE cc.doc_id = ANY(${docIdsLiteral}::text[])
      ORDER BY cc.doc_id, cc.chunk_index
    `);
    return (results.rows as Array<{ content: string; doc_id: string; title: string | null }>)
      .map((r) => ({
        docId: r.doc_id,
        title: r.title ?? r.doc_id,
        content: r.content,
        score: 1,
      }));
  } catch (err) {
    logger.warn({ err, docIds }, "Force-inject chunk fetch failed");
    return [];
  }
}

export async function retrieveRelevantChunks(query: string): Promise<string[]> {
  const chunks = await retrieveRelevantChunksWithScores(query, MAX_CHUNKS);
  return chunks.map((c) => c.content);
}

export async function ingestDocument(docId: string, content: string): Promise<void> {
  const CHUNK_SIZE = 300;
  const OVERLAP = 50;
  const words = content.split(/\s+/);
  const chunks: string[] = [];

  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + CHUNK_SIZE).join(" "));
    i += CHUNK_SIZE - OVERLAP;
  }

  await db.execute(sql`DELETE FROM corpus_chunks WHERE doc_id = ${docId}`);

  for (let idx = 0; idx < chunks.length; idx++) {
    const embedding = await embedText(chunks[idx]);
    if (embedding.length === 0) continue;
    const embeddingStr = `[${embedding.join(",")}]`;
    await db.execute(sql`
      INSERT INTO corpus_chunks (id, doc_id, chunk_index, content, embedding, created_at)
      VALUES (gen_random_uuid(), ${docId}, ${idx}, ${chunks[idx]}, ${embeddingStr}::vector, NOW())
    `);
  }

  logger.info({ docId, chunks: chunks.length }, "Corpus document ingested");
}
