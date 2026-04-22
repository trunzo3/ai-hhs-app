import { db, conversationMetadataTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const MAX_HISTORY_TOKENS = 20000;

const conversationStore = new Map<string, ChatMessage[]>();

export function getHistory(conversationId: string): ChatMessage[] {
  return conversationStore.get(conversationId) ?? [];
}

export function addMessage(conversationId: string, message: ChatMessage): void {
  const history = conversationStore.get(conversationId) ?? [];
  history.push(message);
  conversationStore.set(conversationId, history);
}

export function clearConversation(conversationId: string): void {
  conversationStore.delete(conversationId);
}

export function truncateHistory(messages: ChatMessage[]): ChatMessage[] {
  const MAX_MESSAGES = 20;
  if (messages.length <= MAX_MESSAGES) return messages;
  return messages.slice(messages.length - MAX_MESSAGES);
}

export async function incrementMessageCount(conversationId: string): Promise<void> {
  try {
    await db
      .update(conversationMetadataTable)
      .set({ messageCount: sql`${conversationMetadataTable.messageCount} + 1` })
      .where(eq(conversationMetadataTable.id, conversationId));
  } catch (err) {
    logger.warn({ err, conversationId }, "Failed to increment message count");
  }
}

export async function updateCorpusDocs(conversationId: string, docId: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE conversation_metadata
      SET corpus_docs_retrieved = array_append(COALESCE(corpus_docs_retrieved, '{}'), ${docId})
      WHERE id = ${conversationId}
    `);
  } catch (err) {
    logger.warn({ err }, "Failed to update corpus docs");
  }
}
