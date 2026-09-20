import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { csvArray, csvObjectIds, dateSchema, idParamSchema, validate } from '../../middleware/validate.js';
import { reportLimiter, uploadLimiter } from '../../middleware/rateLimit.js';
import { TRANSACTION_TYPES } from '@khata/shared';
import { badRequest } from '../../lib/errors.js';
import { recordAudit } from '../../services/audit.service.js';
import * as service from './importexport.service.js';

export const importExportRouter: Router = Router();

importExportRouter.use(requireAuth, requireWorkspace);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

importExportRouter.get(
  '/template',
  asyncHandler(async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="khata-import-template.csv"');
    res.send(service.buildImportTemplate());
  }),
);

importExportRouter.get(
  '/transactions.csv',
  reportLimiter,
  validate({
    query: z.object({
      from: dateSchema.optional(),
      to: dateSchema.optional(),
      types: csvArray(TRANSACTION_TYPES),
      accountIds: csvObjectIds,
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const csv = await service.exportTransactionsCsv(scopeOf(req), req.query as never);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${Date.now()}.csv"`);
    res.send(csv);
  }),
);

importExportRouter.get(
  '/people/:id.csv',
  reportLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const csv = await service.exportPersonLedgerCsv(scopeOf(req), param(req, 'id'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ledger-${Date.now()}.csv"`);
    res.send(csv);
  }),
);

importExportRouter.post(
  '/preview',
  uploadLimiter,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw badRequest('Choose a CSV file to import.');
    ok(res, await service.previewImport(scopeOf(req), req.file.buffer.toString('utf-8')));
  }),
);

importExportRouter.post(
  '/commit',
  uploadLimiter,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw badRequest('Choose a CSV file to import.');
    const scope = scopeOf(req);
    const result = await service.commitImport(scope, req.file.buffer.toString('utf-8'), auditContext(req));

    await recordAudit(auditContext(req), {
      action: 'imported',
      entityType: 'Transaction',
      entityId: result.importBatchId,
      summary: `Imported ${result.imported} transactions from CSV (${result.skipped} skipped)`,
    });

    ok(res, result);
  }),
);

importExportRouter.post(
  '/undo/:importBatchId',
  validate({ params: z.object({ importBatchId: z.string().min(8).max(64) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const count = await service.undoImport(scopeOf(req), param(req, 'importBatchId'), auditContext(req));
    ok(res, { undone: count });
  }),
);
