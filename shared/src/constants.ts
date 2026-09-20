/** Domain vocabulary shared by the API and the UI. Change it here, break both builds. */

// ─────────────────────────────────────────────── Workspaces

export const WORKSPACE_MODES = ['personal', 'business'] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

// ─────────────────────────────────────────────── Accounts

export const ACCOUNT_TYPES = [
  'cash',
  'bank',
  'upi',
  'wallet',
  'credit_card',
  'savings',
  'investment',
  'other',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_META: Record<
  AccountType,
  { label: string; icon: string; /** Liability accounts count against net worth. */ liability: boolean }
> = {
  cash: { label: 'Cash', icon: 'Banknote', liability: false },
  bank: { label: 'Bank', icon: 'Landmark', liability: false },
  upi: { label: 'UPI', icon: 'Smartphone', liability: false },
  wallet: { label: 'Wallet', icon: 'Wallet', liability: false },
  credit_card: { label: 'Credit Card', icon: 'CreditCard', liability: true },
  savings: { label: 'Savings', icon: 'PiggyBank', liability: false },
  investment: { label: 'Investment', icon: 'TrendingUp', liability: false },
  other: { label: 'Other', icon: 'Circle', liability: false },
};

// ─────────────────────────────────────────────── Transactions

export const TRANSACTION_TYPES = [
  'income',
  'expense',
  'transfer',
  'lend',
  'borrow',
  'repayment_given',
  'repayment_received',
  'adjustment',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/**
 * The behavioural table from ARCHITECTURE.md §3.1, in code.
 * Every aggregate in the system reads its rules from here, which is what stops a
 * transfer from ever leaking into an income figure (invariant I5).
 */
export const TRANSACTION_META: Record<
  TransactionType,
  {
    label: string;
    /** Verb shown in the quick-add sheet. */
    action: string;
    icon: string;
    /** Counts towards the "Income" figure. */
    isIncome: boolean;
    /** Counts towards the "Expenses" figure. */
    isExpense: boolean;
    /** Moves money between the user's own accounts. */
    isTransfer: boolean;
    /** Touches a person's ledger. */
    isPersonal: boolean;
    /** Direction of cash for the *primary* account leg. */
    direction: 'in' | 'out' | 'both';
    /** Tailwind-ish semantic tone used by the UI. */
    tone: 'positive' | 'negative' | 'neutral';
  }
> = {
  income: {
    label: 'Income', action: 'Money In', icon: 'ArrowDownLeft',
    isIncome: true, isExpense: false, isTransfer: false, isPersonal: false,
    direction: 'in', tone: 'positive',
  },
  expense: {
    label: 'Expense', action: 'Money Out', icon: 'ArrowUpRight',
    isIncome: false, isExpense: true, isTransfer: false, isPersonal: false,
    direction: 'out', tone: 'negative',
  },
  transfer: {
    label: 'Transfer', action: 'Transfer', icon: 'ArrowLeftRight',
    isIncome: false, isExpense: false, isTransfer: true, isPersonal: false,
    direction: 'both', tone: 'neutral',
  },
  lend: {
    label: 'Lent', action: 'Lend', icon: 'HandCoins',
    isIncome: false, isExpense: false, isTransfer: false, isPersonal: true,
    direction: 'out', tone: 'neutral',
  },
  borrow: {
    label: 'Borrowed', action: 'Borrow', icon: 'CreditCard',
    isIncome: false, isExpense: false, isTransfer: false, isPersonal: true,
    direction: 'in', tone: 'neutral',
  },
  repayment_given: {
    label: 'Repayment Given', action: 'Repay', icon: 'Undo2',
    isIncome: false, isExpense: false, isTransfer: false, isPersonal: true,
    direction: 'out', tone: 'neutral',
  },
  repayment_received: {
    label: 'Repayment Received', action: 'Collect', icon: 'Redo2',
    isIncome: false, isExpense: false, isTransfer: false, isPersonal: true,
    direction: 'in', tone: 'neutral',
  },
  adjustment: {
    label: 'Adjustment', action: 'Adjust', icon: 'Scale',
    isIncome: false, isExpense: false, isTransfer: false, isPersonal: false,
    direction: 'both', tone: 'neutral',
  },
};

export const INCOME_TYPES = TRANSACTION_TYPES.filter((t) => TRANSACTION_META[t].isIncome);
export const EXPENSE_TYPES = TRANSACTION_TYPES.filter((t) => TRANSACTION_META[t].isExpense);
export const PERSON_TYPES = TRANSACTION_TYPES.filter((t) => TRANSACTION_META[t].isPersonal);

export const PAYMENT_METHODS = [
  'cash', 'upi', 'card', 'net_banking', 'cheque', 'neft', 'imps', 'rtgs', 'auto_debit', 'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash', upi: 'UPI', card: 'Card', net_banking: 'Net Banking', cheque: 'Cheque',
  neft: 'NEFT', imps: 'IMPS', rtgs: 'RTGS', auto_debit: 'Auto Debit', other: 'Other',
};

// ─────────────────────────────────────────────── Categories

export const CATEGORY_KINDS = ['income', 'expense'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export interface CategorySeed {
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  subcategories?: string[];
  /** Seeded only into this workspace mode; omitted = both. */
  mode?: WorkspaceMode;
}

/** Seeded on workspace creation. Users may add, rename, recolour or archive any of these. */
export const DEFAULT_CATEGORIES: CategorySeed[] = [
  // Income
  { name: 'Salary', kind: 'income', icon: 'Wallet', color: '#3F8F6E' },
  { name: 'Business', kind: 'income', icon: 'Store', color: '#2F7D62' },
  { name: 'Freelance', kind: 'income', icon: 'Laptop', color: '#4A9E7E' },
  { name: 'Interest', kind: 'income', icon: 'Percent', color: '#5BAF8D' },
  { name: 'Dividend', kind: 'income', icon: 'TrendingUp', color: '#3E8B75' },
  { name: 'Refund', kind: 'income', icon: 'RotateCcw', color: '#6BB79A' },
  { name: 'Gift', kind: 'income', icon: 'Gift', color: '#7FC0A6' },
  { name: 'Bonus', kind: 'income', icon: 'Award', color: '#2E8B6B' },
  { name: 'Rental Income', kind: 'income', icon: 'Building2', color: '#55A88A' },
  { name: 'Other Income', kind: 'income', icon: 'CirclePlus', color: '#8AC7B0' },

  // Expense
  {
    name: 'Food', kind: 'expense', icon: 'UtensilsCrossed', color: '#C6613F',
    subcategories: ['Groceries', 'Restaurant', 'Snacks', 'Tea & Coffee', 'Delivery'],
  },
  {
    name: 'Shopping', kind: 'expense', icon: 'ShoppingBag', color: '#B4574E',
    subcategories: ['Clothing', 'Electronics', 'Home', 'Gifts'],
  },
  {
    name: 'Transport', kind: 'expense', icon: 'Bus', color: '#9A6B4F',
    subcategories: ['Auto & Taxi', 'Metro', 'Bus', 'Train', 'Parking'],
  },
  { name: 'Fuel', kind: 'expense', icon: 'Fuel', color: '#A9704A' },
  { name: 'Rent', kind: 'expense', icon: 'House', color: '#8C6E52' },
  {
    name: 'Utilities', kind: 'expense', icon: 'Zap', color: '#B08544',
    subcategories: ['Electricity', 'Water', 'Gas', 'Internet', 'Mobile'],
  },
  { name: 'Education', kind: 'expense', icon: 'GraduationCap', color: '#6F7FA8' },
  {
    name: 'Healthcare', kind: 'expense', icon: 'HeartPulse', color: '#B2596B',
    subcategories: ['Doctor', 'Medicines', 'Tests', 'Insurance'],
  },
  { name: 'Entertainment', kind: 'expense', icon: 'Clapperboard', color: '#8A6BA8' },
  { name: 'Travel', kind: 'expense', icon: 'Plane', color: '#5F8BA8' },
  { name: 'Subscriptions', kind: 'expense', icon: 'Repeat', color: '#7A6BA0' },
  { name: 'EMI', kind: 'expense', icon: 'CalendarClock', color: '#A05A5A' },
  { name: 'Insurance', kind: 'expense', icon: 'ShieldCheck', color: '#5A7F9A' },
  { name: 'Personal', kind: 'expense', icon: 'User', color: '#9B7B62' },
  { name: 'Family', kind: 'expense', icon: 'Users', color: '#A8776B' },
  { name: 'Investment', kind: 'expense', icon: 'LineChart', color: '#4F7F6F' },
  { name: 'Charity', kind: 'expense', icon: 'HeartHandshake', color: '#97705F' },
  { name: 'Other', kind: 'expense', icon: 'CircleDashed', color: '#7E7A73' },

  // Business-only
  { name: 'Purchase', kind: 'expense', icon: 'PackageOpen', color: '#8E6A4A', mode: 'business' },
  { name: 'Salaries & Wages', kind: 'expense', icon: 'UsersRound', color: '#8A6553', mode: 'business' },
  { name: 'Freight & Logistics', kind: 'expense', icon: 'Truck', color: '#7C6A55', mode: 'business' },
  { name: 'Office Expenses', kind: 'expense', icon: 'Building', color: '#7A7161', mode: 'business' },
  { name: 'Marketing', kind: 'expense', icon: 'Megaphone', color: '#A2664F', mode: 'business' },
  { name: 'Professional Fees', kind: 'expense', icon: 'Briefcase', color: '#6E7486', mode: 'business' },
  { name: 'Taxes & Duties', kind: 'expense', icon: 'Receipt', color: '#84695B', mode: 'business' },
  { name: 'Sales', kind: 'income', icon: 'ShoppingCart', color: '#358066', mode: 'business' },
  { name: 'Service Income', kind: 'income', icon: 'Handshake', color: '#42927A', mode: 'business' },
];

// ─────────────────────────────────────────────── People

export const PERSON_RELATIONSHIPS = [
  'friend', 'family', 'customer', 'supplier', 'colleague', 'employee', 'other',
] as const;
export type PersonRelationship = (typeof PERSON_RELATIONSHIPS)[number];

export const PERSON_RELATIONSHIP_LABELS: Record<PersonRelationship, string> = {
  friend: 'Friend', family: 'Family', customer: 'Customer', supplier: 'Supplier',
  colleague: 'Colleague', employee: 'Employee', other: 'Other',
};

// ─────────────────────────────────────────────── Recurrence

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly', 'custom'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

// ─────────────────────────────────────────────── Reminders & notifications

export const REMINDER_TYPES = [
  'receivable', 'payable', 'loan_due', 'bill', 'subscription', 'rent', 'emi', 'recurring', 'custom',
] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

export const NOTIFICATION_TYPES = [
  'money_due', 'money_receivable', 'recurring_upcoming', 'recurring_posted',
  'budget_warning', 'budget_exceeded', 'monthly_summary', 'backup', 'sync_failed',
  'goal_reached', 'security',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// ─────────────────────────────────────────────── Audit

export const AUDIT_ACTIONS = [
  'created', 'updated', 'deleted', 'restored', 'settled', 'transferred',
  'imported', 'exported', 'closed_day', 'closed_month', 'login', 'logout',
  'password_changed', 'backup_created', 'backup_restored',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// ─────────────────────────────────────────────── Preferences

export const DATE_FORMATS = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd MMM yyyy'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const GOAL_ICONS = [
  'Laptop', 'Bike', 'Smartphone', 'Plane', 'GraduationCap', 'ShieldCheck',
  'House', 'Car', 'Gift', 'PiggyBank', 'Heart', 'Target',
] as const;

/** Budget alert thresholds offered by default; users may set their own (§29). */
export const DEFAULT_BUDGET_THRESHOLDS = [50, 75, 90, 100] as const;
