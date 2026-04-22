import { pgTable, text, integer, uuid, timestamp } from "drizzle-orm/pg-core";

export const systemPromptsTable = pgTable("system_prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  layer: integer("layer").notNull().unique(),
  content: text("content").notNull(),
  previousContent: text("previous_content"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SystemPrompt = typeof systemPromptsTable.$inferSelect;
