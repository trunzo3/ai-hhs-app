import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const inquiriesTable = pgTable("inquiries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  userEmail: text("user_email").notNull(),
  inquiryType: text("inquiry_type").notNull(),
  message: text("message").notNull(),
  preferredEmail: text("preferred_email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Inquiry = typeof inquiriesTable.$inferSelect;
