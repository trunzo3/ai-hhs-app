import { db, appConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const DEFAULT_SUPPORT_EMAIL = "anthony@iqmeeteq.com";

async function getConfigValue(key: string): Promise<string | null> {
  try {
    const [row] = await db
      .select()
      .from(appConfigTable)
      .where(eq(appConfigTable.key, key));
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function setConfigValue(key: string, value: string): Promise<void> {
  await db
    .insert(appConfigTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appConfigTable.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getSupportEmail(): Promise<string> {
  const v = await getConfigValue("support_email");
  return (v && v.trim()) ? v.trim() : DEFAULT_SUPPORT_EMAIL;
}

export async function setSupportEmail(email: string): Promise<void> {
  await setConfigValue("support_email", email.trim());
}

export async function getDebugRetrievalLogging(): Promise<boolean> {
  const v = await getConfigValue("debug_retrieval_logging");
  return v === "true";
}

export async function setDebugRetrievalLogging(enabled: boolean): Promise<void> {
  await setConfigValue("debug_retrieval_logging", enabled ? "true" : "false");
}
