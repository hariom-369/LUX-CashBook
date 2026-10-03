import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { IMPORT_DATE_FORMATS } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { idParamSchema, objectIdSchema, validate } from '../../middleware/validate.js';
import { uploadLimiter, writeLimiter } from '../../middleware/rateLimit.js';
import { badRequest } from '../../lib/errors.js';
import * as service from './bankimport.service.js';

export const bankImportRouter: Router = Router();

bankImportRouter.use(requireAuth, requireWorkspace);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

const mappingSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  amount: z.string().optional(),
  debit: z.string().optional(),
  credit: z.string().optional(),
  reference: z.string().optional(),
});

/** Just enough to build the column-mapping UI — no classification yet. */
bankImportRouter.post(
  '/parse',
  uploadLimiter,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw badRequest('Choose a CSV file to import.');
    const { headers, rows } = service.parseRawCsv(req.file.buffer);
    ok(res, { headers, rowCount: rows.length, sampleRows: rows.slice(0, 5) });
  }),
);

function parseOptionsFrom(body: Record<string, string>) {
  const dateFormat = body.dateFormat;
  if (!IMPORT_DATE_FORMATS.includes(dateFormat as never)) throw badRequest('Choose a valid date format.');
  let mapping;
  try {
    mapping = mappingSchema.parse(JSON.parse(body.mapping ?? '{}'));
  } catch {
    throw badRequest('The column mapping was not valid.');
  }
  if (!body.accountId) throw badRequest('Choose which account this statement is for.');
  return { accountId: body.accountId, dateFormat: dateFormat as (typeof IMPORT_DATE_FORMATS)[number], mapping };
}

bankImportRouter.post(
  '/preview',
  uploadLimiter,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw badRequest('Choose a CSV file to import.');
    const options = parseOptionsFrom(req.body as Record<string, string>);
    ok(res, await service.previewBankImport(scopeOf(req), req.file.buffer, options));
  }),
);

bankImportRouter.post(
  '/commit',
  uploadLimiter,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw badRequest('Choose a CSV file to import.');
    const options = parseOptionsFrom(req.body as Record<string, string>);
    let selection: service.CommitSelection;
    try {
      selection = z
        .object({ importRowNumbers: z.array(z.number().int()), matchRowNumbers: z.array(z.number().int()) })
        .parse(JSON.parse((req.body as Record<string, string>).selection ?? '{}'));
    } catch {
      throw badRequest('The row selection was not valid.');
    }
    ok(res, await service.commitBankImport(scopeOf(req), req.file.buffer, options, selection, auditContext(req)));
  }),
);

bankImportRouter.get(
  '/profiles',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listImportProfiles(scopeOf(req)));
  }),
);

bankImportRouter.post(
  '/profiles',
  writeLimiter,
  validate({
    body: z.object({
      name: z.string().trim().min(1, 'Give this profile a name.').max(60),
      dateFormat: z.enum(IMPORT_DATE_FORMATS),
      mapping: mappingSchema,
      defaultAccountId: objectIdSchema.nullable().optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    created(res, await service.createImportProfile(scopeOf(req), req.body));
  }),
);

bankImportRouter.delete(
  '/profiles/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteImportProfile(scopeOf(req), param(req, 'id'));
    ok(res, { deleted: true });
  }),
);
