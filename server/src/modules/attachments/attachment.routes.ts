import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { DOCUMENT_TYPES } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import {
  amountMinorSchema,
  dateSchema,
  idParamSchema,
  objectIdSchema,
  queryBoolean,
  text,
  validate,
} from '../../middleware/validate.js';
import { uploadLimiter, writeLimiter } from '../../middleware/rateLimit.js';
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

const uploadBodySchema = z.object({
  transactionId: objectIdSchema.optional(),
  docType: z.enum(DOCUMENT_TYPES).optional(),
  title: text(120),
  expiryDate: dateSchema.optional(),
  tags: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20) : [])),
  amountMinor: amountMinorSchema.optional(),
  accountId: objectIdSchema.optional(),
});

attachmentRouter.post(
  '/',
  uploadLimiter,
  upload.single('file'),
  validate({ body: uploadBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw badRequest('Choose a file to upload.');

    const attachment = await service.uploadAttachment(
      scopeOf(req),
      {
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
        transactionId: req.body.transactionId,
        docType: req.body.docType,
        title: req.body.title,
        expiryDate: req.body.expiryDate,
        tags: req.body.tags,
        amountMinor: req.body.amountMinor,
        accountId: req.body.accountId,
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

/** The receipt gallery / document vault (§Phase 6). */
attachmentRouter.get(
  '/',
  validate({
    query: z.object({
      docType: z.enum(DOCUMENT_TYPES).optional(),
      tags: z.string().optional().transform((v) => (v ? v.split(',').map((t) => t.trim()).filter(Boolean) : undefined)),
      search: z.string().trim().max(120).optional(),
      includeDeleted: queryBoolean(false),
      expiringBefore: dateSchema.optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listDocuments(scopeOf(req), req.query as never));
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

attachmentRouter.post(
  '/:id/restore',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const attachment = await service.restoreAttachment(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, service.toAttachmentDto(attachment));
  }),
);
