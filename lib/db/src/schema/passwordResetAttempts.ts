import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const passwordResetAttemptsTable = pgTable("password_reset_attempts", {
  email: text("email").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PasswordResetAttempt = typeof passwordResetAttemptsTable.$inferSelect;
