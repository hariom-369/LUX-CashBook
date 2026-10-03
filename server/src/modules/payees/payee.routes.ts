import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { PayeeDto } from '@khata/shared';
import { Payee, Transaction, type IPayee } from '../../models/index.js';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { idParamSchema, objectIdSchema, tagsSchema, text, validate, queryBoolean } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { recordAudit } from '../../services/audit.service.js';

export const payeeRouter: Router = Router();

payeeRouter.use(requireAuth, requireWorkspace);

function toPayeeDto(payee: IPayee): PayeeDto {
  return {
    id: String(payee._id),
    workspaceId: String(payee.workspaceId),
    name: payee.name,
    defaultAccountId: payee.defaultAccountId ? String(payee.defaultAccountId) : undefined,
    defaultCategoryId: payee.defaultCategoryId ? String(payee.defaultCategoryId) : undefined,
    notes: payee.notes,
    tags: payee.tags,
    isArchived: payee.isArchived,
    lastUsedAt: payee.lastUsedAt ? payee.lastUsedAt.toISOString() : undefined,
    createdAt: payee.createdAt.toISOString(),
    updatedAt: payee.updatedAt.toISOString(),
  };
}

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give this payee a name.').max(80),
  defaultAccountId: objectIdSchema.nullable().optional(),
  defaultCategoryId: objectIdSchema.nullable().optional(),
  notes: text(500),
  tags: tagsSchema,
});

const updateSchema = createSchema.partial().extend({ isArchived: z.boolean().optional() });

payeeRouter.get(
  '/',
  validate({
    query: z.object({
      search: z.string().trim().max(120).optional(),
      includeArchived: queryBoolean(false),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const { search, includeArchived } = req.query as unknown as { search?: string; includeArchived: boolean };

    const filter: Record<string, unknown> = { workspaceId: scope.workspaceId };
    if (!includeArchived) filter.isArchived = false;
    if (search) filter.name = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

    // Most-recently-used first — the whole point of a payee list is picking the
    // right one fast during entry, and recency predicts that far better than
    // alphabetical order.
    const payees = await Payee.find(filter)
      .sort({ lastUsedAt: -1, name: 1 })
      .limit(200)
      .lean();

    ok(res, payees.map((p) => toPayeeDto(p)));
  }),
);

payeeRouter.post(
  '/',
  writeLimiter,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const count = await Payee.countDocuments({ workspaceId: scope.workspaceId });
    if (count >= 500) throw conflict('You can have up to 500 payees.', 'PAYEE_LIMIT');

    let payee: IPayee;
    try {
      payee = await Payee.create({
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        name: req.body.name,
        defaultAccountId: req.body.defaultAccountId ?? null,
        defaultCategoryId: req.body.defaultCategoryId ?? null,
        notes: req.body.notes,
        tags: req.body.tags,
      });
    } catch (err) {
      if (err instanceof Error && (err as { code?: number }).code === 11000) {
        throw conflict(`You already have a payee named "${req.body.name}".`, 'DUPLICATE_PAYEE');
      }
      throw err;
    }

    await recordAudit(
      { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) },
      { action: 'created', entityType: 'Payee', entityId: payee._id, summary: `Added payee "${payee.name}"` },
    );

    created(res, toPayeeDto(payee));
  }),
);

payeeRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const payee = await Payee.findOne({ _id: param(req, 'id'), workspaceId: scope.workspaceId });
    if (!payee) throw notFound('Payee');

    for (const key of ['name', 'defaultAccountId', 'defaultCategoryId', 'notes', 'tags', 'isArchived'] as const) {
      if (req.body[key] !== undefined) (payee as unknown as Record<string, unknown>)[key] = req.body[key];
    }

    try {
      await payee.save();
    } catch (err) {
      if (err instanceof Error && (err as { code?: number }).code === 11000) {
        throw conflict(`You already have a payee named "${payee.name}".`, 'DUPLICATE_PAYEE');
      }
      throw err;
    }

    ok(res, toPayeeDto(payee));
  }),
);

/**
 * Delete or archive a payee — same rule as a category (category.routes.ts):
 * one in use is archived, not deleted, so a past transaction never points at
 * nothing and a report never quietly changes.
 */
payeeRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const payee = await Payee.findOne({ _id: param(req, 'id'), workspaceId: scope.workspaceId });
    if (!payee) throw notFound('Payee');

    const inUse = await Transaction.countDocuments({
      workspaceId: scope.workspaceId,
      payeeId: payee._id,
      deletedAt: null,
    });

    if (inUse > 0) {
      payee.isArchived = true;
      await payee.save();
      ok(res, { archived: true, deleted: false, transactionCount: inUse });
      return;
    }

    await payee.deleteOne();

    await recordAudit(
      { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) },
      { action: 'deleted', entityType: 'Payee', entityId: payee._id, summary: `Deleted unused payee "${payee.name}"` },
    );

    ok(res, { archived: false, deleted: true, transactionCount: 0 });
  }),
);
