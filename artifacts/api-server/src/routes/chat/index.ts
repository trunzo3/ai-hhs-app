import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import { db, conversationMetadataTable, responseRatingsTable, usersTable, taskLauncherCardsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { buildSystemPromptFromDB } from "../../lib/systemPrompt";
import { retrieveRelevantChunks } from "../../lib/rag";
import {
  getHistory,
  addMessage,
  clearConversation,
  truncateHistory,
  incrementMessageCount,
} from "../../lib/conversationStore";
import { getActiveModel, trackTokenUsage } from "../../lib/tokenTracker";
import {
  StartConversationBody,
  RateResponseBody,
  RateResponseParams,
} from "@workspace/api-zod";
import { logger } from "../../lib/logger";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const router: IRouter = Router();

const WORD_MEDIA_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

function requireAuth(req: any, res: any, next: any): void {
  if (!(req.session as any).userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

router.get("/chat/task-cards", async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        id: taskLauncherCardsTable.id,
        title: taskLauncherCardsTable.title,
        description: taskLauncherCardsTable.description,
        displayOrder: taskLauncherCardsTable.displayOrder,
      })
      .from(taskLauncherCardsTable)
      .orderBy(asc(taskLauncherCardsTable.displayOrder), asc(taskLauncherCardsTable.title));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "Failed to fetch task launcher cards");
    res.status(500).json({ error: "Failed to fetch task launcher cards" });
  }
});

router.post("/chat/conversation/start", requireAuth, async (req, res): Promise<void> => {
  const userId = (req.session as any).userId;
  const parsed = StartConversationBody.safeParse(req.body);
  const taskLauncher = parsed.success ? (parsed.data.taskLauncher ?? null) : null;

  const [conversation] = await db
    .insert(conversationMetadataTable)
    .values({ userId, taskLauncherUsed: taskLauncher })
    .returning();

  res.status(201).json({ conversationId: conversation.id });
});

router.post("/chat/message", requireAuth, async (req, res): Promise<void> => {
  const userId = (req.session as any).userId;
  const { conversationId, message, fileBase64, fileMediaType, taskLauncher, workingOutsideArea } = req.body;

  if (!conversationId || message == null) {
    res.status(400).json({ error: "conversationId and message are required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const ragContext = await retrieveRelevantChunks(message);
  const systemPrompt = await buildSystemPromptFromDB({
    ragContext,
    county: user.county,
    serviceCategory: user.serviceCategory,
    workingOutsideArea: workingOutsideArea ?? false,
    taskLauncher: taskLauncher ?? null,
  });

  if (taskLauncher) {
    await db.update(conversationMetadataTable)
      .set({ taskLauncherUsed: taskLauncher })
      .where(eq(conversationMetadataTable.id, conversationId));
  }

  const userText = message.trim() || (fileBase64 ? "Document attached" : "");

  const history = truncateHistory(getHistory(conversationId));
  addMessage(conversationId, { role: "user", content: userText, timestamp: new Date() });

  const messageContent: Anthropic.ContentBlockParam[] = [];
  let hasPDF = false;

  if (fileBase64 && fileMediaType) {
    if (fileMediaType === "application/pdf") {
      hasPDF = true;
      messageContent.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: fileBase64,
        },
      } as any);
    } else if (WORD_MEDIA_TYPES.includes(fileMediaType)) {
      try {
        const buffer = Buffer.from(fileBase64, "base64");
        const result = await mammoth.extractRawText({ buffer });
        const extractedText = result.value.trim();
        if (extractedText) {
          messageContent.push({
            type: "text",
            text: `[Attached Word Document]\n\n${extractedText}`,
          });
        }
      } catch (err) {
        logger.warn({ err }, "Failed to extract text from Word document");
        messageContent.push({ type: "text", text: "[A Word document was attached but could not be read.]" });
      }
    }
  }

  messageContent.push({ type: "text", text: userText || "Document attached" });

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: messageContent },
  ];

  const model = await getActiveModel();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  let fullResponse = "";

  try {
    const requestOptions = hasPDF
      ? { headers: { "anthropic-beta": "pdfs-2024-09-25" } }
      : undefined;

    const stream = anthropic.messages.stream(
      { model, max_tokens: 2048, system: systemPrompt, messages },
      requestOptions,
    );

    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        const token = chunk.delta.text;
        fullResponse += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }

    const finalMessage = await stream.finalMessage();
    const inputTokens = finalMessage.usage.input_tokens;
    const outputTokens = finalMessage.usage.output_tokens;
    await trackTokenUsage(inputTokens, outputTokens, model);

    let followUps: string[] = ["Simpler", "What's missing?"];
    const jsonMatch = fullResponse.match(/\s*\{"followUps":\s*\[[\s\S]*?\]\}\s*$/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0].trim());
        if (Array.isArray(parsed.followUps)) followUps = parsed.followUps;
        fullResponse = fullResponse.slice(0, fullResponse.length - jsonMatch[0].length).trimEnd();
      } catch { /* keep defaults */ }
    }

    addMessage(conversationId, { role: "assistant", content: fullResponse, timestamp: new Date() });
    await incrementMessageCount(conversationId);

    res.write(`data: ${JSON.stringify({ done: true, followUps })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error("[chat] Anthropic error:", {
      status: err?.status,
      message: err?.message,
      error: err?.error,
      headers: err?.headers,
      hasPDF,
      fileMediaType,
    });
    req.log.error({ err }, "Error calling Anthropic API");
    let errorMessage = "Something went wrong. Please try again.";
    if (err?.status === 400 && err?.message?.includes("credit balance")) {
      errorMessage = "The AI service is temporarily unavailable due to account limits. Please contact the administrator.";
    } else if (err?.status === 400 && hasPDF) {
      errorMessage = "Unable to process this PDF. Try converting it to text and pasting the content instead.";
    } else if (err?.status === 400) {
      errorMessage = "Unable to process this request. If you attached a file, try removing it and resending.";
    } else if (err?.status === 529 || err?.status === 503) {
      errorMessage = "The AI service is overloaded. Please wait a moment and try again.";
    }
    res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
    res.end();
  }
});

router.post("/chat/conversation/:conversationId/rate", requireAuth, async (req, res): Promise<void> => {
  const userId = (req.session as any).userId;

  const params = RateResponseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = RateResponseBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { rating, messageIndex } = body.data;
  const { conversationId } = params.data;

  await db.insert(responseRatingsTable).values({ conversationId, userId, rating, messageIndex });
  res.json({ success: true });
});

export default router;
