import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler, ok } from '../../lib/http.js';
import { requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { scopeOf } from '../../middleware/context.js';
import { validate, text } from '../../middleware/validate.js';
import { reportLimiter } from '../../middleware/rateLimit.js';
import { badRequest } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { getAiStatus, askAssistant, extractDraftFromText, extractDraftFromReceipt } from './ai.service.js';

export const aiRouter: Router = Router();

aiRouter.use(requireAuth, requireWorkspace);

/** Whether the server has a provider key configured and this user has opted in — the client uses this to show/hide the assistant entirely. */
aiRouter.get(
  '/status',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await getAiStatus(scopeOf(req)));
  }),
);

aiRouter.post(
  '/ask',
  reportLimiter,
  validate({ body: z.object({ question: text(500) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { question } = req.body as { question?: string };
    if (!question) throw badRequest('Ask a question first.');
    ok(res, await askAssistant(scopeOf(req), question));
  }),
);

aiRouter.post(
  '/draft',
  reportLimiter,
  validate({ body: z.object({ text: text(500) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { text: input } = req.body as { text?: string };
    if (!input) throw badRequest('Describe the transaction first.');
    ok(res, await extractDraftFromText(scopeOf(req), input));
  }),
);

const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
});

aiRouter.post(
  '/draft/receipt',
  reportLimiter,
  receiptUpload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw badRequest('Choose a receipt photo to upload.');
    if (!req.file.mimetype.startsWith('image/')) throw badRequest('That file is not an image.');

    const draft = await extractDraftFromReceipt(scopeOf(req), {
      mediaType: req.file.mimetype,
      base64: req.file.buffer.toString('base64'),
    });
    ok(res, draft);
  }),
);
