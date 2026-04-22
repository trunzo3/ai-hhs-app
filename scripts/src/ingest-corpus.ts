import { readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import pg from "pg";

const { Pool } = pg;

let _extractor: any = null;

async function getExtractor() {
  if (!_extractor) {
    const { pipeline } = await import("@xenova/transformers");
    _extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    console.log("Embedding model loaded.");
  }
  return _extractor;
}

async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data) as number[];
}

function chunkText(content: string, chunkSize = 300, overlap = 50): string[] {
  const words = content.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
    i += chunkSize - overlap;
  }
  return chunks;
}

async function ingestDirectory(pool: pg.Pool, dir: string): Promise<void> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const docId = basename(file, ".md");
    const content = readFileSync(join(dir, file), "utf-8");
    const chunks = chunkText(content);

    console.log(`Ingesting ${docId} (${chunks.length} chunks)...`);

    await pool.query("DELETE FROM corpus_chunks WHERE doc_id = $1", [docId]);

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embedText(chunks[i]);
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
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  console.log("Initializing embedding model (downloading if needed ~23MB)...");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const corpusRoot = process.env.CORPUS_ROOT ?? join(new URL("../../corpus", import.meta.url).pathname);
  const dirs = [
    join(corpusRoot, "methodology"),
    join(corpusRoot, "task-chains"),
    join(corpusRoot, "prompts"),
    join(corpusRoot, "workflows"),
  ];

  for (const dir of dirs) {
    try {
      await ingestDirectory(pool, dir);
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
