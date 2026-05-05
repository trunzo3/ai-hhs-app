#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Apply idempotent DDL for tables/columns added post-baseline.
# This runs BEFORE drizzle-kit push so the schema diff is clean and
# drizzle's interactive rename-detection prompts don't block deploys.
if [ -n "$DATABASE_URL" ] && command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" <<'SQL'
ALTER TABLE IF EXISTS task_launcher_cards ADD COLUMN IF NOT EXISTS task_chain_prompt text;

CREATE TABLE IF NOT EXISTS retrieval_debug_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid,
  user_id uuid,
  user_email text,
  query text NOT NULL,
  chunks jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retrieval_debug_log_created_at_idx ON retrieval_debug_log (created_at DESC);

CREATE TABLE IF NOT EXISTS password_reset_attempts (
  email text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
SQL
fi

pnpm --filter db push
