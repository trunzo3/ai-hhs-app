import { pgTable, text, integer, uuid, timestamp } from "drizzle-orm/pg-core";

export const taskLauncherCardsTable = pgTable("task_launcher_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  displayOrder: integer("display_order").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TaskLauncherCard = typeof taskLauncherCardsTable.$inferSelect;
