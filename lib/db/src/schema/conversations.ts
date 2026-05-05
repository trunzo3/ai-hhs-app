import { pgTable, text, integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const conversationMetadataTable = pgTable("conversation_metadata", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  messageCount: integer("message_count").notNull().default(0),
  taskLauncherUsed: text("task_launcher_used"),
  taskLauncherCardId: uuid("task_launcher_card_id"),
  corpusDocsRetrieved: text("corpus_docs_retrieved").array().default([]),
});

export const insertConversationSchema = createInsertSchema(conversationMetadataTable).omit({
  id: true,
  startedAt: true,
  messageCount: true,
  corpusDocsRetrieved: true,
});

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversationMetadataTable.$inferSelect;
