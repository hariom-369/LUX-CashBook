import type { Types } from 'mongoose';
import { Account, Category, type IWorkspace } from '../../models/index.js';
import type { RequestScope } from '../../middleware/context.js';
import type { AuditContext } from '../../services/audit.service.js';
import { createAccount } from '../accounts/account.service.js';
import { createPerson } from '../people/person.service.js';
import { createTransaction } from '../transactions/transaction.service.js';
import { createWorkspace, type WorkspaceDoc } from './workspace.service.js';

const DAY = 86_400_000;

/**
 * A ready-made sample workspace (§Phase 16), flagged `isDemo` so the UI marks
 * it and deleting it needs no name confirmation. Built entirely through the
 * ordinary services — no hand-written postings — so the demo can never hold a
 * state the real engine couldn't produce. Idempotent by name: a second call
 * reports a conflict rather than stacking duplicates.
 */
export async function createDemoWorkspace(userId: Types.ObjectId, audit: Omit<AuditContext, 'userId'>): Promise<WorkspaceDoc> {
  const workspace = await createWorkspace(userId, { name: 'Demo workspace', mode: 'personal', currency: 'INR', isDemo: true, seedCashAccount: true });
  const scope: RequestScope = { userId, workspaceId: workspace._id, currency: workspace.currency, mode: workspace.mode as IWorkspace['mode'], role: 'owner', hiddenAccountIds: [] };
  const ctx: AuditContext = { ...audit, userId, workspaceId: workspace._id };

  const bank = await createAccount(scope, { name: 'Demo Bank', type: 'bank', openingBalanceMinor: 5_000_000 }, ctx);
  const cash = await Account.findOne({ workspaceId: workspace._id, type: 'cash' }).lean();
  const friend = await createPerson(scope, { name: 'Asha (demo)', relationship: 'friend' }, ctx);
  const [food, salary] = await Promise.all([
    Category.findOne({ workspaceId: workspace._id, kind: 'expense', isArchived: false }).lean(),
    Category.findOne({ workspaceId: workspace._id, kind: 'income', isArchived: false }).lean(),
  ]);
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);

  await createTransaction(scope, { type: 'income', amountMinor: 6_000_000, date: at(20), accountId: String(bank._id), categoryId: salary ? String(salary._id) : undefined, description: 'Salary' }, ctx);
  for (const [i, amount] of [45_000, 120_000, 78_000, 30_000, 210_000].entries()) {
    await createTransaction(scope, { type: 'expense', amountMinor: amount, date: at(15 - i * 3), accountId: String(bank._id), categoryId: food ? String(food._id) : undefined, description: `Sample expense ${i + 1}` }, ctx);
  }
  if (cash) await createTransaction(scope, { type: 'transfer', amountMinor: 200_000, date: at(10), accountId: String(bank._id), toAccountId: String(cash._id), description: 'Cash withdrawal' }, ctx);
  await createTransaction(scope, { type: 'lend', amountMinor: 150_000, date: at(7), accountId: String(bank._id), personId: String(friend._id), description: 'Lent to Asha', dueDate: new Date(Date.now() + 14 * DAY) }, ctx);

  return workspace;
}
