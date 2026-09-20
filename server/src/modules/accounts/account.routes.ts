import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ACCOUNT_TYPES } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { amountMinorSchema, dateSchema, idParamSchema, text, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './account.service.js';
import { recomputeAccountBalance } from '../../services/balance.service.js';

export const accountRouter: Router = Router();

accountRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Choose a valid colour.');

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give this account a name.').max(60),
  type: z.enum(ACCOUNT_TYPES),
  openingBalanceMinor: amountMinorSchema.default(0),
  openingDate: dateSchema.optional(),
  bankName: text(80),
  last4: z
    .string()
    .regex(/^\d{4}$/, 'Enter the last 4 digits only.')
    .optional()
    .or(z.literal('')),
  color: hexColor.optional(),
  icon: text(48),
  isLiability: z.boolean().optional(),
  blockNegativeBalance: z.boolean().optional(),
  creditLimitMinor: amountMinorSchema.refine((n) => n >= 0, 'Enter a positive limit.').optional(),
  excludeFromTotals: z.boolean().optional(),
  notes: text(500),
  isPettyCash: z.boolean().optional(),
});

const updateSchema = createSchema
  .partial()
  .omit({ type: true, isPettyCash: true })
  .extend({ isActive: z.boolean().optional(), sortOrder: z.number().int().optional() });

accountRouter.get(
  '/',
  validate({ query: z.object({ includeInactive: z.coerce.boolean().default(false) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const accounts = await service.listAccounts(scopeOf(req), {
      includeInactive: (req.query as { includeInactive?: boolean }).includeInactive,
    });
    const totalMinor = accounts
      .filter((a) => !a.excludeFromTotals)
      .reduce((sum, a) => sum + a.balanceMinor, 0);
    ok(res, accounts, { totalMinor, count: accounts.length });
  }),
);

accountRouter.post(
  '/',
  writeLimiter,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const account = await service.createAccount(scopeOf(req), req.body, auditContext(req));
    created(res, service.toAccountDto(account));
  }),
);

accountRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const account = await service.getAccount(scopeOf(req), param(req, 'id'));
    ok(res, service.toAccountDto(account));
  }),
);

accountRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const account = await service.updateAccount(scopeOf(req), param(req, 'id'), req.body, auditContext(req));
    ok(res, service.toAccountDto(account));
  }),
);

accountRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.deleteAccount(scopeOf(req), param(req, 'id'), auditContext(req)));
  }),
);

/** Per-account ledger with a running balance (§52). */
accountRouter.get(
  '/:id/ledger',
  validate({
    params: idParamSchema,
    query: z.object({
      from: dateSchema.optional(),
      to: dateSchema.optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const ledger = await service.getAccountLedger(
      scopeOf(req),
      param(req, 'id'),
      req.query as { from?: Date; to?: Date; page?: number; limit?: number },
    );
    ok(res, ledger);
  }),
);

/**
 * Rebuild this account's balance from its transactions.
 *
 * Exposed to the user rather than kept as an internal repair tool: §72 promises
 * every balance is traceable to the underlying records, and this is the button that
 * proves it.
 */
accountRouter.post(
  '/:id/recompute',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const account = await service.getAccount(scope, param(req, 'id'));
    const before = account.cachedBalanceMinor;
    const balanceMinor = await recomputeAccountBalance(scope.workspaceId, account._id);
    ok(res, { balanceMinor, previousMinor: before, changed: balanceMinor !== before });
  }),
);
