import { db, appConfigTable, tokenUsageTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

// Anthropic Claude 4.x pricing per million tokens — verified against
// https://claude.com/pricing on 2026-05-05.
// Opus 4.x: $15 input / $75 output per 1M tokens.
// Sonnet 4.x: $3 input / $15 output per 1M tokens.
// If pricing changes upstream, update both constants and the verification date.
const OPUS_INPUT_COST = 15.0 / 1_000_000;
const OPUS_OUTPUT_COST = 75.0 / 1_000_000;
const SONNET_INPUT_COST = 3.0 / 1_000_000;
const SONNET_OUTPUT_COST = 15.0 / 1_000_000;

const DEFAULT_MODEL = "claude-opus-4-6";
const DOWNGRADE_MODEL = "claude-sonnet-4-6";

export function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function getActiveModel(): Promise<string> {
  try {
    const [row] = await db
      .select()
      .from(appConfigTable)
      .where(eq(appConfigTable.key, "active_model"));
    return row?.value ?? DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

export async function getSpendThreshold(): Promise<number> {
  try {
    const [row] = await db
      .select()
      .from(appConfigTable)
      .where(eq(appConfigTable.key, "spend_threshold"));
    return parseFloat(row?.value ?? "200");
  } catch {
    return 200;
  }
}

export async function trackTokenUsage(
  inputTokens: number,
  outputTokens: number,
  model: string
): Promise<void> {
  const month = getCurrentMonth();
  const isOpus = model.includes("opus");
  const cost =
    inputTokens * (isOpus ? OPUS_INPUT_COST : SONNET_INPUT_COST) +
    outputTokens * (isOpus ? OPUS_OUTPUT_COST : SONNET_OUTPUT_COST);

  try {
    await db.execute(sql`
      INSERT INTO token_usage (id, month, input_tokens, output_tokens, estimated_cost, updated_at)
      VALUES (${month}, ${month}, ${inputTokens}, ${outputTokens}, ${cost}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        input_tokens = token_usage.input_tokens + ${inputTokens},
        output_tokens = token_usage.output_tokens + ${outputTokens},
        estimated_cost = token_usage.estimated_cost + ${cost},
        updated_at = NOW()
    `);

    const [usage] = await db
      .select()
      .from(tokenUsageTable)
      .where(eq(tokenUsageTable.id, month));

    const threshold = await getSpendThreshold();
    const currentCost = usage?.estimatedCost ?? 0;

    if (currentCost >= threshold) {
      await db
        .insert(appConfigTable)
        .values({ key: "active_model", value: DOWNGRADE_MODEL })
        .onConflictDoUpdate({
          target: appConfigTable.key,
          set: { value: DOWNGRADE_MODEL, updatedAt: new Date() },
        });
      logger.info({ currentCost, threshold }, "Auto-downgraded to Sonnet due to spend threshold");
    }
  } catch (err) {
    logger.error({ err }, "Failed to track token usage");
  }
}

export async function getCurrentMonthSpend(): Promise<{ spend: number; tokens: number }> {
  const month = getCurrentMonth();
  try {
    const [usage] = await db
      .select()
      .from(tokenUsageTable)
      .where(eq(tokenUsageTable.id, month));
    return {
      spend: usage?.estimatedCost ?? 0,
      tokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
    };
  } catch {
    return { spend: 0, tokens: 0 };
  }
}
