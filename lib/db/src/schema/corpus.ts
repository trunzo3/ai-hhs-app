import { pgTable, text, integer, timestamp, uuid, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(384)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});

export const corpusChunksTable = pgTable("corpus_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  docId: text("doc_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCorpusChunkSchema = createInsertSchema(corpusChunksTable).omit({
  id: true,
  createdAt: true,
});

export type InsertCorpusChunk = z.infer<typeof insertCorpusChunkSchema>;
export type CorpusChunk = typeof corpusChunksTable.$inferSelect;
