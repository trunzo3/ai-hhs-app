import { Router, type IRouter } from "express";
import { db, inquiriesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

function requireAuth(req: any, res: any, next: any): void {
  if (!(req.session as any).userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

router.post("/inquiries", requireAuth, async (req, res): Promise<void> => {
  const userId = (req.session as any).userId as string;
  const { inquiryType, message, preferredEmail } = req.body ?? {};

  if (!inquiryType || !message || !preferredEmail) {
    res.status(400).json({ error: "inquiryType, message, and preferredEmail are required" });
    return;
  }

  try {
    const userRows = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
    const userEmail = userRows[0]?.email ?? "unknown";

    await db.insert(inquiriesTable).values({
      userId,
      userEmail,
      inquiryType: String(inquiryType),
      message: String(message),
      preferredEmail: String(preferredEmail),
    });

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save inquiry" });
  }
});

export default router;
