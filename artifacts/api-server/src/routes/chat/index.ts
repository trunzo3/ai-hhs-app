import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db, conversationMetadataTable, responseRatingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildSystemPrompt } from "../../lib/systemPrompt";
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

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const router: IRouter = Router();

function requireAuth(req: any, res: any, next: any): void {
  if (!(req.session as any).userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

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
  const systemPrompt = buildSystemPrompt({
    ragContext,
    county: user.county,
    serviceCategory: user.serviceCategory,
    workingOutsideArea: workingOutsideArea ?? false,
    taskLauncher: taskLauncher ?? null,
  });

  const history = truncateHistory(getHistory(conversationId));
  addMessage(conversationId, { role: "user", content: message, timestamp: new Date() });

  const messageContent: Anthropic.ContentBlockParam[] = [];

  if (fileBase64 && fileMediaType) {
    messageContent.push({
      type: "document",
      source: {
        type: "base64",
        media_type: fileMediaType as "application/pdf",
        data: fileBase64,
      },
    } as any);
  }

  messageContent.push({ type: "text", text: message });

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
    const stream = await anthropic.messages.stream({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    });

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
    const jsonMatch = fullResponse.match(/\{"followUps":\[.*?\]\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.followUps)) {
          followUps = parsed.followUps;
        }
        fullResponse = fullResponse.replace(jsonMatch[0], "").trim();
      } catch {}
    }

    addMessage(conversationId, { role: "assistant", content: fullResponse, timestamp: new Date() });
    await incrementMessageCount(conversationId);

    res.write(`data: ${JSON.stringify({ done: true, followUps })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Error calling Anthropic API");
    res.write(`data: ${JSON.stringify({ error: "Something went wrong. Please try again." })}\n\n`);
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

  await db.insert(responseRatingsTable).values({
    conversationId,
    userId,
    rating,
    messageIndex,
  });

  res.json({ success: true });
});

export default router;
