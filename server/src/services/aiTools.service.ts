import type { RequestScope } from '../middleware/context.js';
import type { ToolDefinition } from '../lib/ai.js';
import { getCategoryReport, getNetWorth } from '../modules/reports/report.service.js';
import { listBudgetsWithProgress } from '../modules/budgets/budget.service.js';
import { getReceivablesAndPayables } from '../modules/people/person.service.js';
import { listReminders } from '../modules/reminders/reminder.service.js';
import { getForecast } from '../modules/forecast/forecast.service.js';

/**
 * Read-only tool handlers for the AI assistant (§Phase 10, decision 7).
 *
 * Every tool here calls an existing, already-tested service function with
 * the caller's own `scope` — never raw DB access, never a write, never an
 * id supplied by the model that wasn't first produced by one of these same
 * read calls. The assistant can only ever see what the calling user could
 * already see through the ordinary API.
 */

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export const AI_TOOLS: ToolDefinition[] = [
  {
    name: 'spending_by_category',
    description:
      'Get spending or income broken down by category for a date range. Amounts are in the amount minor unit (e.g. paise for INR) — divide by 100 before quoting a figure to the user.',
    input_schema: {
      type: 'object',
      properties: {
        fromDaysAgo: { type: 'number', description: 'Start of the range, in days before today. Defaults to 30.' },
        toDaysAgo: { type: 'number', description: 'End of the range, in days before today. Defaults to 0 (today).' },
        kind: { type: 'string', enum: ['income', 'expense'], description: 'Which side to report. Defaults to expense.' },
      },
    },
  },
  {
    name: 'net_worth',
    description: 'Get the workspace\'s current net worth: total assets, liabilities, and the breakdown by account category.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'budget_status',
    description: 'Get every active budget with how much of it has been spent this period, and its status (safe/warning/critical/exceeded).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'people_balances',
    description: 'Get who owes the user money and who the user owes money to (lending/borrowing balances), with totals.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'bills_due',
    description: 'Get upcoming bills and reminders that are not yet marked done, soonest first.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'cash_flow_forecast',
    description: 'Get a projected cash-flow forecast for the next N days based on recurring income/expenses. This is an estimate, never a guarantee.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How many days ahead to project. Defaults to 30.' },
      },
    },
  },
];

export async function callAiTool(scope: RequestScope, name: string, input: unknown): Promise<unknown> {
  const args = (input ?? {}) as Record<string, unknown>;

  switch (name) {
    case 'spending_by_category': {
      const fromDaysAgo = typeof args.fromDaysAgo === 'number' ? args.fromDaysAgo : 30;
      const toDaysAgo = typeof args.toDaysAgo === 'number' ? args.toDaysAgo : 0;
      const kind = args.kind === 'income' ? 'income' : 'expense';
      return getCategoryReport(scope, { from: daysAgo(fromDaysAgo), to: daysAgo(toDaysAgo), kind });
    }
    case 'net_worth':
      return getNetWorth(scope);
    case 'budget_status':
      return listBudgetsWithProgress(scope);
    case 'people_balances':
      return getReceivablesAndPayables(scope);
    case 'bills_due':
      return listReminders(scope, { includeDone: false });
    case 'cash_flow_forecast': {
      const days = typeof args.days === 'number' ? args.days : 30;
      return getForecast(scope, days);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
