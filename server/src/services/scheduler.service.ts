import { Workspace } from '../models/index.js';
import { logger } from '../lib/logger.js';
import { processDueRecurring } from '../modules/recurring/recurring.service.js';
import { syncLoanReminders, raiseDueReminderNotifications } from '../modules/reminders/reminder.service.js';
import { checkBudgetAlerts } from '../modules/budgets/budget.service.js';
import type { RequestScope } from '../middleware/context.js';

/**
 * The background scheduler (§21, §18, §29, §41).
 *
 * A single interval loop rather than a job queue: at this scale (one process,
 * modest workspace counts) a queue would be complexity with no payoff, and a
 * simple tick that is safe to run concurrently — because every state change it
 * makes is either an atomic claim or an idempotent upsert — gets the same
 * correctness without the operational surface area.
 *
 * Each concern is independent and one workspace's failure cannot block another's:
 * every per-workspace step is wrapped so a thrown error is logged and skipped
 * rather than aborting the whole sweep.
 */
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

const TICK_INTERVAL_MS = 5 * 60 * 1000; // five minutes

export async function runSchedulerTick(now: Date = new Date()): Promise<void> {
  if (running) {
    logger.warn('Scheduler tick skipped — previous tick still running');
    return;
  }
  running = true;

  try {
    // Recurring transactions are global — they post regardless of which
    // workspace's dashboard happens to be open right now.
    await processDueRecurring(now).catch((err) => logger.error({ err }, 'Recurring sweep failed'));

    // Loan reminders and budget alerts are per-workspace, so walk every
    // workspace and isolate failures to the one that caused them.
    const workspaces = await Workspace.find().select('_id userId currency mode').lean();

    for (const workspace of workspaces) {
      const scope: RequestScope = {
        userId: workspace.userId,
        workspaceId: workspace._id,
        currency: workspace.currency,
        mode: workspace.mode,
      };

      await syncLoanReminders(scope).catch((err) =>
        logger.error({ err, workspaceId: String(workspace._id) }, 'Loan reminder sync failed'),
      );
      await checkBudgetAlerts(scope, now).catch((err) =>
        logger.error({ err, workspaceId: String(workspace._id) }, 'Budget alert check failed'),
      );
    }

    await raiseDueReminderNotifications(now).catch((err) =>
      logger.error({ err }, 'Reminder notification sweep failed'),
    );
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  if (timer) return;
  logger.info({ intervalMinutes: TICK_INTERVAL_MS / 60_000 }, 'Scheduler started');

  // Run once shortly after boot rather than waiting a full interval, so a
  // recurring transaction due since before the last restart posts promptly.
  const initial = setTimeout(() => void runSchedulerTick(), 10_000);
  initial.unref();

  timer = setInterval(() => void runSchedulerTick(), TICK_INTERVAL_MS);
  timer.unref();
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
