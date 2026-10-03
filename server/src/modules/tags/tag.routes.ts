import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { scopeOf } from '../../middleware/context.js';
import { dateSchema, validate } from '../../middleware/validate.js';
import { reportLimiter, writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './tag.service.js';

export const tagRouter: Router = Router();
tagRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};
const tagText = z.string().trim().min(1).max(service.MAX_TAG_LENGTH);

tagRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listTags(scopeOf(req)));
  }),
);

tagRouter.get(
  '/report',
  reportLimiter,
  validate({ query: z.object({ from: dateSchema, to: dateSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to } = req.query as unknown as { from: Date; to: Date };
    ok(res, await service.getTagReport(scopeOf(req), from, to));
  }),
);

tagRouter.post(
  '/rename',
  writeLimiter,
  validate({ body: z.object({ from: tagText, to: tagText }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.renameTag(scopeOf(req), req.body.from, req.body.to, auditContext(req)));
  }),
);

tagRouter.post(
  '/merge',
  writeLimiter,
  validate({ body: z.object({ sources: z.array(tagText).min(1).max(30), target: tagText }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.mergeTags(scopeOf(req), req.body.sources, req.body.target, auditContext(req)));
  }),
);

tagRouter.post(
  '/delete',
  writeLimiter,
  validate({ body: z.object({ tag: tagText }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.deleteTag(scopeOf(req), req.body.tag, auditContext(req)));
  }),
);
