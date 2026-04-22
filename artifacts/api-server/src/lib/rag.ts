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

export async function retrieveRelevantChunks(query: string): Promise<string[]> {
  try {
    const embedding = await embedText(query);
    if (embedding.length === 0) return [];

    const embeddingStr = `[${embedding.join(",")}]`;

    const results = await db.execute(sql`
      SELECT content, doc_id
      FROM corpus_chunks
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${MAX_CHUNKS}
    `);

    return (results.rows as Array<{ content: string; doc_id: string }>)
      .map((r) => r.content)
      .slice(0, MAX_CHUNKS);
  } catch (err) {
    logger.warn({ err }, "RAG retrieval failed, continuing without context");
    return [];
  }
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
