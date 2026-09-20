import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { CATEGORY_KINDS, type CategoryDto } from '@khata/shared';
import { Category, Transaction, type ICategory } from '../../models/index.js';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { idParamSchema, objectIdSchema, text, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { recordAudit } from '../../services/audit.service.js';

export const categoryRouter: Router = Router();

categoryRouter.use(requireAuth, requireWorkspace);

function toCategoryDto(category: ICategory, children: ICategory[] = []): CategoryDto {
  return {
    id: String(category._id),
    workspaceId: String(category.workspaceId),
    name: category.name,
    kind: category.kind,
    icon: category.icon,
    color: category.color,
    parentId: category.parentId ? String(category.parentId) : null,
    isSystem: category.isSystem,
    isArchived: category.isArchived,
    sortOrder: category.sortOrder,
    ...(children.length ? { children: children.map((child) => toCategoryDto(child)) } : {}),
  };
}

const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Choose a valid colour.');

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give this category a name.').max(50),
  kind: z.enum(CATEGORY_KINDS),
  icon: text(48),
  color: hexColor.optional(),
  parentId: objectIdSchema.nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  icon: text(48),
  color: hexColor.optional(),
  isArchived: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

/** Returns a two-level tree — subcategories nested under their parent. */
categoryRouter.get(
  '/',
  validate({
    query: z.object({
      kind: z.enum(CATEGORY_KINDS).optional(),
      includeArchived: z.coerce.boolean().default(false),
      flat: z.coerce.boolean().default(false),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    // `validate` has already replaced req.query with the parsed, coerced object;
    // Express's own ParsedQs typing no longer describes it.
    const { kind, includeArchived, flat } = req.query as unknown as {
      kind?: 'income' | 'expense';
      includeArchived: boolean;
      flat: boolean;
    };

    const filter: Record<string, unknown> = { workspaceId: scope.workspaceId };
    if (kind) filter.kind = kind;
    if (!includeArchived) filter.isArchived = false;

    const all = await Category.find(filter).sort({ sortOrder: 1, name: 1 }).lean();

    if (flat) {
      ok(res, all.map((category) => toCategoryDto(category)));
      return;
    }

    const byParent = new Map<string, ICategory[]>();
    for (const category of all) {
      if (!category.parentId) continue;
      const key = String(category.parentId);
      byParent.set(key, [...(byParent.get(key) ?? []), category]);
    }

    const roots = all
      .filter((category) => !category.parentId)
      .map((category) => toCategoryDto(category, byParent.get(String(category._id)) ?? []));

    ok(res, roots);
  }),
);

categoryRouter.post(
  '/',
  writeLimiter,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const count = await Category.countDocuments({ workspaceId: scope.workspaceId });
    if (count >= 300) throw conflict('You can have up to 300 categories.', 'CATEGORY_LIMIT');

    const category = await Category.create({
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      name: req.body.name,
      kind: req.body.kind,
      icon: req.body.icon ?? 'Circle',
      color: req.body.color ?? '#B08D4F',
      parentId: req.body.parentId ?? null,
      isSystem: false,
      sortOrder: count,
    });

    await recordAudit(
      { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) },
      {
        action: 'created',
        entityType: 'Category',
        entityId: category._id,
        summary: `Created ${category.kind} category "${category.name}"`,
      },
    );

    created(res, toCategoryDto(category));
  }),
);

categoryRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const category = await Category.findOne({ _id: param(req, 'id'), workspaceId: scope.workspaceId });
    if (!category) throw notFound('Category');

    Object.assign(category, req.body);
    await category.save();

    ok(res, toCategoryDto(category));
  }),
);

/**
 * Delete or archive a category.
 *
 * A category in use is archived rather than deleted: removing it would leave
 * historical transactions pointing at nothing, and a year-old expense report would
 * quietly change. Archiving hides it from the picker and leaves the past intact.
 */
categoryRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const category = await Category.findOne({ _id: param(req, 'id'), workspaceId: scope.workspaceId });
    if (!category) throw notFound('Category');

    const inUse = await Transaction.countDocuments({
      workspaceId: scope.workspaceId,
      $or: [{ categoryId: category._id }, { subcategoryId: category._id }],
      deletedAt: null,
    });

    const hasChildren = await Category.countDocuments({
      workspaceId: scope.workspaceId,
      parentId: category._id,
      isArchived: false,
    });

    if (inUse > 0 || hasChildren > 0 || category.isSystem) {
      category.isArchived = true;
      await category.save();
      ok(res, { archived: true, deleted: false, transactionCount: inUse });
      return;
    }

    await category.deleteOne();

    await recordAudit(
      { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) },
      {
        action: 'deleted',
        entityType: 'Category',
        entityId: category._id,
        summary: `Deleted unused category "${category.name}"`,
      },
    );

    ok(res, { archived: false, deleted: true, transactionCount: 0 });
  }),
);
