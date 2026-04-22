import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const corpusDocumentsTable = pgTable("corpus_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  docId: text("doc_id").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("Methodology"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCorpusDocumentSchema = createInsertSchema(corpusDocumentsTable).omit({ id: true });
export type InsertCorpusDocument = z.infer<typeof insertCorpusDocumentSchema>;
export type CorpusDocument = typeof corpusDocumentsTable.$inferSelect;
