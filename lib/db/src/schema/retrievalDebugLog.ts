import { pgTable, text, uuid, timestamp, jsonb } from "drizzle-orm/pg-core";

export const retrievalDebugLogTable = pgTable("retrieval_debug_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id"),
  userId: uuid("user_id"),
  userEmail: text("user_email"),
  query: text("query").notNull(),
  chunks: jsonb("chunks").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RetrievalDebugLog = typeof retrievalDebugLogTable.$inferSelect;
