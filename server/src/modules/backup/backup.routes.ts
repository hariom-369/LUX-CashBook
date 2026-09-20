import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { userIdOf, scopeOf } from '../../middleware/context.js';
import { validate } from '../../middleware/validate.js';
import { reportLimiter, uploadLimiter } from '../../middleware/rateLimit.js';
import { badRequest } from '../../lib/errors.js';
import { recordAudit } from '../../services/audit.service.js';
import { toWorkspaceDto, listWorkspaces } from '../workspaces/workspace.service.js';
import * as service from './backup.service.js';

export const backupRouter: Router = Router();

backupRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

backupRouter.get(
  '/',
  requireWorkspace,
  reportLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const backup = await service.createBackup(scopeOf(req));

    await recordAudit(
      { userId: userIdOf(req), workspaceId: scopeOf(req).workspaceId, ...actorOf(req) },
      { action: 'backup_created', entityType: 'Workspace', entityId: scopeOf(req).workspaceId, summary: 'Downloaded a full backup' },
    );

    const fileName = `khata-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(JSON.stringify(backup, null, 2));
  }),
);

backupRouter.post(
  '/restore',
  uploadLimiter,
  upload.single('file'),
  validate({ body: z.object({ workspaceName: z.string().trim().max(60).optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw badRequest('Choose a backup file to restore.');

    let payload: unknown;
    try {
      payload = JSON.parse(req.file.buffer.toString('utf-8'));
    } catch {
      throw badRequest('That file is not valid JSON.');
    }

    const userId = userIdOf(req);
    const result = await service.restoreBackup(userId, payload as never, req.body.workspaceName);

    await recordAudit(
      { userId, workspaceId: null, ...actorOf(req) },
      { action: 'backup_restored', entityType: 'Workspace', entityId: result.workspaceId, summary: `Restored a backup into a new workspace (${Object.values(result.counts).reduce((a, b) => a + b, 0)} records)` },
    );

    const workspaces = await listWorkspaces(userId);
    created(res, { ...result, workspaces: workspaces.map(toWorkspaceDto) });
  }),
);
