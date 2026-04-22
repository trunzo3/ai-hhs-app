import { readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import OpenAI from "openai";
import pg from "pg";

const { Pool } = pg;

async function embedText(openai: OpenAI, text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

function chunkText(content: string, chunkSize = 300, overlap = 50): string[] {
  const words = content.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(" ");
    chunks.push(chunk);
    i += chunkSize - overlap;
  }
  return chunks;
}

async function ingestDirectory(
  pool: pg.Pool,
  openai: OpenAI,
  dir: string
): Promise<void> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const docId = basename(file, ".md");
    const content = readFileSync(join(dir, file), "utf-8");
    const chunks = chunkText(content);

    console.log(`Ingesting ${docId} (${chunks.length} chunks)...`);

    await pool.query("DELETE FROM corpus_chunks WHERE doc_id = $1", [docId]);

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embedText(openai, chunks[i]);
      const embeddingStr = `[${embedding.join(",")}]`;
      await pool.query(
        "INSERT INTO corpus_chunks (id, doc_id, chunk_index, content, embedding, created_at) VALUES (gen_random_uuid(), $1, $2, $3, $4::vector, NOW())",
        [docId, i, chunks[i], embeddingStr]
      );
    }
    console.log(`  Done: ${docId}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const openai = new OpenAI({ apiKey: process.env.ANTHROPIC_API_KEY });

  const corpusRoot = join(process.cwd(), "corpus");
  const dirs = [
    join(corpusRoot, "methodology"),
    join(corpusRoot, "task-chains"),
    join(corpusRoot, "prompts"),
    join(corpusRoot, "workflows"),
  ];

  for (const dir of dirs) {
    try {
      await ingestDirectory(pool, openai, dir);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        console.log(`Skipping ${dir} (not found)`);
      } else {
        throw err;
      }
    }
  }

  await pool.end();
  console.log("Corpus ingestion complete!");
}

main().catch(console.error);
