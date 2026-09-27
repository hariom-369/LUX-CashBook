/**
 * English — the source catalogue. Every key the app uses is defined here first;
 * other languages may omit keys and fall back to these.
 *
 * Conventions (docs/FEATURE_ROADMAP.md, decision 6):
 * - Keys are `area.thing`, e.g. `security.activity.title`.
 * - Values use `{name}` placeholders, never string concatenation in components.
 * - Plurals are separate keys ending in an `Intl.PluralRules` category:
 *   `.one`, `.other` (Hindi and English need only these two).
 */
export const en = {
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.retry': 'Try again',
  'common.save': 'Save',
  'common.loading': 'Loading…',

  'install.action': 'Install Khata',

  'notifications.channels.note': "Khata notifies you inside the app. Email and browser notifications aren't available yet.",

  'pin.unlock': 'Unlock',

  'security.activity.title': 'Recent activity',
  'security.activity.description': 'Sign-ins and changes to your account security. If something here wasn’t you, change your password.',
  'security.activity.empty': 'Nothing recorded yet.',
  'security.activity.error': 'Could not load your recent activity.',
  'security.activity.at': '{device} · {ip}',
  'security.activity.unknownIp': 'Unknown location',

  'account.delete.title': 'Delete account',
  'account.delete.description': 'Permanently remove your account and everything in it.',
  'account.delete.action': 'Delete account…',
  'account.delete.sheetTitle': 'Delete your account?',
  'account.delete.consequences': 'This permanently deletes your account, every workspace, and all transactions, accounts, people, budgets, goals, reminders and receipts stored in Khata. It can’t be undone, and there is no recovery period.',
  'account.delete.backupFirst': 'Download a backup first from Settings → Data if you may want this data later.',
  'account.delete.password': 'Your password',
  'account.delete.confirmLabel': 'Type DELETE to confirm',
  'account.delete.confirmHint': 'In capital letters, exactly as shown.',
  'account.delete.submit': 'Delete everything',
  'account.delete.done': 'Your account has been deleted',
  'account.delete.failed': 'Could not delete your account',

  'dataHealth.title': 'Data health',
  'dataHealth.description': 'Check that every balance still adds up exactly from the transactions behind it.',
  'dataHealth.check': 'Check my data',
  'dataHealth.recheck': 'Check again',
  'dataHealth.failed': 'Could not run the check',
  'dataHealth.healthy': 'Everything adds up — {accounts} accounts, {people} people and {transactions} transactions checked.',
  'dataHealth.issues.one': '{count} thing needs attention',
  'dataHealth.issues.other': '{count} things need attention',
  'dataHealth.issue.account_balance': '{name}: shows {actual}, but its transactions add up to {expected}.',
  'dataHealth.issue.person_balance': '{name}: shows {actual}, but the ledger adds up to {expected}.',
  'dataHealth.issue.orphan_posting': '{name}: an entry points at an account that no longer exists.',
  'dataHealth.issue.unbalanced_transfer': '{name}: a transfer whose two sides don’t cancel out.',
  'dataHealth.issue.other': '{name}: {detail}',
  'dataHealth.repair': 'Recalculate balances',
  'dataHealth.repairExplain': 'Recalculates the stored balances from your transactions. No transaction is changed, added or removed.',
  'dataHealth.repaired': 'Balances recalculated',
  'dataHealth.manual': 'Anything still listed can’t be fixed automatically — review those entries yourself.',

  'reminders.title': 'Reminders',
  'reminders.description': 'Bills, rent, EMIs and anything else you want a nudge about.',
  'reminders.add': 'Add reminder',
  'reminders.empty': 'No reminders yet. Add one for a bill, rent or anything with a date.',
  'reminders.error': 'Could not load your reminders.',
  'reminders.done': 'Mark {title} done',
  'reminders.delete': 'Delete {title}',
  'reminders.completed': 'Reminder done',
  'reminders.deleted': 'Reminder deleted',
  'reminders.saved': 'Reminder added',
  'reminders.failed': 'Could not update that reminder',
  'reminders.overdue': 'Overdue · {when}',
  'reminders.form.title': 'New reminder',
  'reminders.form.name': 'What is it?',
  'reminders.form.namePlaceholder': 'Electricity bill',
  'reminders.form.type': 'Type',
  'reminders.form.due': 'Due date',
  'reminders.form.amount': 'Amount',
  'reminders.form.amountHint': 'Optional.',
  'reminders.form.lead': 'Notify me',
  'reminders.form.lead.0': 'On the day',
  'reminders.form.lead.1': '1 day before',
  'reminders.form.lead.3': '3 days before',
  'reminders.form.lead.7': '1 week before',
  'reminders.type.bill': 'Bill',
  'reminders.type.rent': 'Rent',
  'reminders.type.emi': 'EMI',
  'reminders.type.subscription': 'Subscription',
  'reminders.type.custom': 'Other',

  'transactions.filter.tag': 'Tag',
  'transactions.filter.tagPlaceholder': 'e.g. travel',
  'transactions.filter.amountFrom': 'Amount from',
  'transactions.filter.amountTo': 'Amount up to',
  'transactions.filter.withReceipts': 'With receipts only',
  'transactions.filter.outstanding': 'Unsettled loans only',
} as const;

export type MessageKey = keyof typeof en;
