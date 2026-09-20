import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { idParamSchema, objectIdSchema, validate } from '../../middleware/validate.js';
import { uploadLimiter } from '../../middleware/rateLimit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import * as service from './attachment.service.js';

export const attachmentRouter: Router = Router();

attachmentRouter.use(requireAuth, requireWorkspace);

// Held in memory rather than streamed to disk first: uploads are capped at
// MAX_UPLOAD_MB (10MB by default), small enough that buffering costs nothing and
// sharp needs the whole image in memory to re-encode it anyway.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
});

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

attachmentRouter.post(
  '/',
  uploadLimiter,
  upload.single('file'),
  validate({ body: z.object({ transactionId: objectIdSchema.optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw badRequest('Choose a file to upload.');

    const attachment = await service.uploadAttachment(
      scopeOf(req),
      {
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
        transactionId: req.body.transactionId,
      },
      auditContext(req),
    );

    created(res, service.toAttachmentDto(attachment));
  }),
);

attachmentRouter.get(
  '/transaction/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listAttachmentsForTransaction(scopeOf(req), param(req, 'id')));
  }),
);

/**
 * Download an attachment.
 *
 * Authorised and re-checked against workspace ownership on every request — the
 * storage key alone is never treated as a capability, which is what keeps a leaked
 * or guessed URL from becoming an IDOR hole (§69).
 */
attachmentRouter.get(
  '/:id/download',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const attachment = await service.getAttachment(scopeOf(req), param(req, 'id'));
    const buffer = await service.readAttachmentFile(attachment);

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }),
);

attachmentRouter.get(
  '/:id/thumbnail',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const attachment = await service.getAttachment(scopeOf(req), param(req, 'id'));
    const buffer = await service.readThumbnail(attachment);
    if (!buffer) throw notFound('Thumbnail');

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }),
);

attachmentRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteAttachment(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { deleted: true });
  }),
);
