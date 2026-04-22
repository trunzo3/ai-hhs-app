import { Router, type IRouter } from "express";
import { db, feedbackTable } from "@workspace/db";
import { SubmitFeedbackBody } from "@workspace/api-zod";

const router: IRouter = Router();

function requireAuth(req: any, res: any, next: any): void {
  if (!(req.session as any).userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

router.post("/feedback", requireAuth, async (req, res): Promise<void> => {
  const userId = (req.session as any).userId;

  const parsed = SubmitFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { feedbackType, detail, attemptedFileSize } = parsed.data;

  await db.insert(feedbackTable).values({
    userId,
    feedbackType,
    detail: detail ?? null,
    attemptedFileSize: attemptedFileSize ?? null,
  });

  res.status(201).json({ success: true });
});

export default router;
