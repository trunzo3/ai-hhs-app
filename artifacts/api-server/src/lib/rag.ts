import OpenAI from "openai";
import { db, corpusChunksTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const openai = new OpenAI({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY });

const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_CHUNKS = 3;
const TOKEN_BUDGET = 4000;

export async function embedText(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });
    return response.data[0].embedding;
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

export async function ingestDocument(
  docId: string,
  content: string
): Promise<void> {
  const CHUNK_SIZE = 300;
  const OVERLAP = 50;
  const words = content.split(/\s+/);
  const chunks: string[] = [];

  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + CHUNK_SIZE).join(" ");
    chunks.push(chunk);
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
