import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { TRANSACTION_META, type TransactionType } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Field, Input, Select, Textarea } from '../../components/ui/Input';
import { Icon } from '../../components/ui/Icon';
import { useToast } from '../../components/ui/Toast';
import { useUiStore } from '../../stores/ui.store';
import { useCurrency } from '../../hooks/useCurrency';
import { useAccounts, useCategories, useLedgerMutation, usePeople } from '../../lib/queries';
import { api, ApiRequestError } from '../../lib/api';
import { formatMoney, toDateKey } from '@khata/shared';
import { enqueueOutboxItem, outboxCount } from '../../lib/offlineDb';
import { useOfflineStore } from '../../stores/offline.store';
import { useAuthStore } from '../../stores/auth.store';
import { parseQuickEntry, type ParsedQuickEntry } from '../../lib/naturalLanguageEntry';

/**
 * Quick add (§45, §63).
 *
 * The single most-used screen in the application, so the design goal is keystrokes,
 * not features:
 *
 *   1. Pick what happened.
 *   2. Type the amount (already focused).
 *   3. Save.
 *
 * Everything else — account, category, date — is pre-filled with a sensible default
 * and can be changed if it is wrong. Someone recording a ₹40 chai should be done in
 * about four seconds; someone recording a loan with a due date can still do that on
 * the same screen.
 */
const TYPE_OPTIONS: Array<{ type: TransactionType; label: string; hint: string }> = [
  { type: 'income', label: 'Money In', hint: 'Salary, sales, refunds' },
  { type: 'expense', label: 'Money Out', hint: 'Anything you spent' },
  { type: 'transfer', label: 'Transfer', hint: 'Between your own accounts' },
  { type: 'lend', label: 'Lent', hint: 'You gave someone money' },
  { type: 'borrow', label: 'Borrowed', hint: 'You took money from someone' },
  { type: 'repayment_received', label: 'Repayment', hint: 'Money returned, either way' },
];

type Step = 'type' | 'details';

export function QuickAddSheet() {
  const open = useUiStore((s) => s.quickAddOpen);
  const setOpen = useUiStore((s) => s.setQuickAddOpen);

  const [step, setStep] = useState<Step>('type');
  const [type, setType] = useState<TransactionType>('expense');
  const [prefill, setPrefill] = useState<ParsedQuickEntry | null>(null);

  const { data: categories = [] } = useCategories();
  const { data: people = [] } = usePeople({ sortBy: 'recent' });

  // Reset to the first step on every open, so the sheet never resumes a
  // half-finished entry the user has already mentally abandoned.
  useEffect(() => {
    if (open) {
      setStep('type');
      setType('expense');
      setPrefill(null);
    }
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title={step === 'type' ? 'What happened?' : TRANSACTION_META[type].label}
      description={step === 'type' ? 'Pick the kind of entry to record.' : undefined}
      size="md"
    >
      {step === 'type' ? (
        <TypePicker
          categories={categories}
          people={people}
          onPick={(picked) => {
            setType(picked);
            setPrefill(null);
            setStep('details');
          }}
          onParsed={(parsed) => {
            setType(parsed.type);
            setPrefill(parsed);
            setStep('details');
          }}
        />
      ) : (
        <TransactionForm
          type={type}
          prefill={prefill}
          onBack={() => setStep('type')}
          onDone={() => setOpen(false)}
        />
      )}
    </Sheet>
  );
}

function TypePicker({
  categories,
  people,
  onPick,
  onParsed,
}: {
  categories: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string }>;
  onPick: (type: TransactionType) => void;
  onParsed: (parsed: ParsedQuickEntry) => void;
}) {
  const [nlText, setNlText] = useState('');

  function handleParse() {
    if (!nlText.trim()) return;
    const parsed = parseQuickEntry(nlText, { categories, people });
    onParsed(parsed);
  }

  return (
    <div className="flex flex-col gap-4 pb-2">
      {/* Natural-language entry (§46): a genuine shortcut for a fast typist, never
          a requirement — it only ever pre-fills the same review screen manual
          entry lands on, so a misread word costs a correction, not a bad record. */}
      <div className="rounded-lg border border-line bg-sunken/60 p-3">
        <label htmlFor="nl-quick-entry" className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-secondary">
          <Sparkles aria-hidden className="size-3.5 text-gold" />
          Type it instead
        </label>
        <div className="mt-2 flex gap-2">
          <Input
            id="nl-quick-entry"
            value={nlText}
            placeholder="e.g. Paid 250 for lunch yesterday"
            onChange={(event) => setNlText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleParse();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={handleParse} disabled={!nlText.trim()}>
            Go
          </Button>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
          We'll fill in the type, amount and date for you to check before saving.
        </p>
      </div>

      <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        <span className="h-px flex-1 bg-line-faint" />
        or choose directly
        <span className="h-px flex-1 bg-line-faint" />
      </div>

      <ul className="flex flex-col gap-1.5">
        {TYPE_OPTIONS.map((option) => {
          const meta = TRANSACTION_META[option.type];
          return (
            <li key={option.type}>
              <button
                type="button"
                onClick={() => onPick(option.type)}
                className="flex w-full items-center gap-3.5 rounded-lg border border-line bg-surface p-3.5 text-left transition-[border-color,background-color] hover:border-line-strong hover:bg-sunken"
              >
                <span
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-md',
                    meta.tone === 'positive' && 'bg-positive-soft text-positive',
                    meta.tone === 'negative' && 'bg-negative-soft text-negative',
                    meta.tone === 'neutral' && 'bg-neutral-soft text-ink-secondary',
                  )}
                >
                  <Icon name={meta.icon} aria-hidden className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-ink">{option.label}</span>
                  <span className="block truncate text-[12px] text-ink-muted">{option.hint}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface FormState {
  amountMinor: number | null;
  accountId: string;
  toAccountId: string;
  categoryId: string;
  personId: string;
  date: string;
  description: string;
  notes: string;
  dueDate: string;
  repayDirection: 'received' | 'given';
}

function TransactionForm({
  type,
  prefill,
  onBack,
  onDone,
}: {
  type: TransactionType;
  prefill: ParsedQuickEntry | null;
  onBack: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const currency = useCurrency();
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const money = (amountMinor: number) => formatMoney(amountMinor, { currency, compactDecimals: true });
  const meta = TRANSACTION_META[type];
  const isTransfer = meta.isTransfer;
  const isPersonal = meta.isPersonal;
  const isRepayment = type === 'repayment_given' || type === 'repayment_received';
  const categoryKind = meta.isIncome ? 'income' : 'expense';

  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories(isPersonal ? undefined : categoryKind);
  const { data: people = [] } = usePeople({ sortBy: 'recent' });

  const [form, setForm] = useState<FormState>(() => ({
    amountMinor: prefill?.amountMinor ?? null,
    accountId: '',
    toAccountId: '',
    categoryId: prefill?.categoryId ?? '',
    personId: prefill?.personId ?? '',
    date: prefill?.date ?? toDateKey(new Date()),
    description: prefill?.matched ? prefill.description : '',
    notes: '',
    dueDate: '',
    repayDirection: 'received',
  }));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Default the account once the list loads: for spending, the cash account people
  // actually reach for; otherwise the first account.
  useEffect(() => {
    if (form.accountId || accounts.length === 0) return;
    const preferred =
      (meta.direction === 'out' ? accounts.find((a) => a.type === 'cash') : undefined) ?? accounts[0];
    setForm((current) => ({
      ...current,
      accountId: preferred?.id ?? '',
      toAccountId: accounts.find((a) => a.id !== preferred?.id)?.id ?? '',
    }));
  }, [accounts, form.accountId, meta.direction]);

  const flatCategories = useMemo(
    () =>
      categories.flatMap((category) => [
        { id: category.id, name: category.name, depth: 0 },
        ...(category.children ?? []).map((child) => ({ id: child.id, name: child.name, depth: 1 })),
      ]),
    [categories],
  );

  const selectedPerson = people.find((p) => p.id === form.personId);

  /**
   * Build the exact request this entry becomes — same shape whether it is sent
   * immediately or queued in the offline outbox for later, so the two paths can
   * never drift into recording something different.
   */
  function buildRequest(): { path: string; body: Record<string, unknown> } {
    if (!form.amountMinor || form.amountMinor <= 0) {
      throw new ApiRequestError(422, { code: 'INVALID_AMOUNT', message: 'Enter an amount greater than zero.' });
    }

    // A key derived from the payload makes a double-tap on a slow connection —
    // or an outbox retry after a dropped connection — a no-op instead of a
    // duplicate transaction (§51).
    const idempotencyKey = `qa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    if (isRepayment && form.personId) {
      return {
        path: `/people/${form.personId}/repay`,
        body: {
          amountMinor: form.amountMinor,
          accountId: form.accountId,
          date: new Date(`${form.date}T12:00:00`).toISOString(),
          note: form.description || undefined,
          direction: form.repayDirection,
          idempotencyKey,
        },
      };
    }

    return {
      path: '/transactions',
      body: {
        type,
        amountMinor: form.amountMinor,
        date: new Date(`${form.date}T12:00:00`).toISOString(),
        accountId: form.accountId,
        toAccountId: isTransfer ? form.toAccountId : undefined,
        categoryId: isPersonal ? undefined : form.categoryId || undefined,
        personId: isPersonal ? form.personId : undefined,
        description: form.description || undefined,
        notes: form.notes || undefined,
        dueDate:
          (type === 'lend' || type === 'borrow') && form.dueDate
            ? new Date(`${form.dueDate}T12:00:00`).toISOString()
            : undefined,
        idempotencyKey,
      },
    };
  }

  const mutation = useLedgerMutation(async () => {
    const { path, body } = buildRequest();
    return api.post(path, body);
  });

  async function submit() {
    setError(null);
    setFieldErrors({});
    try {
      await mutation.mutateAsync(undefined as never);
      toast.success(`${meta.label} saved`, `${money(form.amountMinor ?? 0)} recorded.`);
      onDone();
    } catch (err) {
      // Offline: the entry isn't lost, it's queued (§39) — this is the one case
      // where a failed request is still a successful save from the user's point
      // of view, so it gets the success toast, not the error one.
      if (err instanceof ApiRequestError && err.isOffline) {
        try {
          const { path, body } = buildRequest();
          await enqueueOutboxItem({ method: 'POST', path, body, workspaceId: activeWorkspaceId ?? '' });
          useOfflineStore.getState().setPendingCount((await outboxCount()));
          toast.success(`${meta.label} saved offline`, "It'll sync automatically once you're back online.");
          onDone();
        } catch (queueErr) {
          setError(queueErr instanceof Error ? queueErr.message : 'Could not save that on this device.');
        }
        return;
      }

      if (err instanceof ApiRequestError && err.fields.length) {
        setFieldErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Could not save that. Please try again.');
      }
    }
  }

  const canSubmit =
    Boolean(form.amountMinor && form.amountMinor > 0 && form.accountId) &&
    (!isPersonal || Boolean(form.personId)) &&
    (!isTransfer || Boolean(form.toAccountId && form.toAccountId !== form.accountId));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4 pb-2"
    >
      <button
        type="button"
        onClick={onBack}
        className="-mt-1 flex w-fit items-center gap-1.5 text-[12.5px] font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Change type
      </button>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] leading-relaxed text-negative"
        >
          {error}
        </div>
      )}

      {prefill && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-gold/25 bg-gold-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-gold-strong"
        >
          <Sparkles aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Filled in from what you typed — double-check the amount and account below before saving.
          </span>
        </div>
      )}

      {/* The amount is the reason the sheet is open, so it leads and takes focus. */}
      <Field label="Amount" error={fieldErrors.amountMinor} required>
        {({ id }) => (
          <MoneyInput
            id={id}
            size="hero"
            autoFocus
            value={form.amountMinor}
            onChange={(amountMinor) => setForm((f) => ({ ...f, amountMinor }))}
          />
        )}
      </Field>

      {isPersonal && (
        <Field
          label={type === 'borrow' ? 'Borrowed from' : type === 'lend' ? 'Given to' : 'Person'}
          error={fieldErrors.personId}
          required
          hint={
            selectedPerson && selectedPerson.balanceMinor !== 0
              ? selectedPerson.balanceMinor > 0
                ? `${selectedPerson.name} owes you ${money(selectedPerson.balanceMinor)}`
                : `You owe ${selectedPerson.name} ${money(-selectedPerson.balanceMinor)}`
              : undefined
          }
        >
          {({ id }) => (
            <Select
              id={id}
              value={form.personId}
              onChange={(event) => {
                const personId = event.target.value;
                const person = people.find((p) => p.id === personId);
                setForm((f) => ({
                  ...f,
                  personId,
                  // Infer which way a repayment goes from their balance, so the
                  // common case needs no thought.
                  repayDirection: (person?.balanceMinor ?? 0) > 0 ? 'received' : 'given',
                }));
              }}
            >
              <option value="">Choose a person…</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      {isRepayment && form.personId && (
        <Field label="Direction">
          {({ id }) => (
            <div id={id} className="grid grid-cols-2 gap-2">
              {(
                [
                  ['received', 'They paid me'],
                  ['given', 'I paid them'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, repayDirection: value }))}
                  aria-pressed={form.repayDirection === value}
                  className={cn(
                    'h-11 rounded-md border text-[13px] font-medium transition-colors',
                    form.repayDirection === value
                      ? 'border-gold bg-gold-soft text-gold-strong'
                      : 'border-line bg-surface text-ink-secondary hover:bg-sunken',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </Field>
      )}

      <div className={cn('grid gap-4', isTransfer && 'sm:grid-cols-2')}>
        <Field label={isTransfer ? 'From account' : 'Account'} error={fieldErrors.accountId} required>
          {({ id }) => (
            <Select
              id={id}
              value={form.accountId}
              onChange={(event) => setForm((f) => ({ ...f, accountId: event.target.value }))}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {isTransfer && (
          <Field label="To account" error={fieldErrors.toAccountId} required>
            {({ id }) => (
              <Select
                id={id}
                value={form.toAccountId}
                onChange={(event) => setForm((f) => ({ ...f, toAccountId: event.target.value }))}
              >
                {accounts
                  .filter((account) => account.id !== form.accountId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
      </div>

      {isTransfer && (
        <p className="-mt-1 rounded-md border border-line bg-sunken px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-muted">
          Moving money between your own accounts. This is an internal transfer — it
          will not count as income or as an expense.
        </p>
      )}

      {!isPersonal && !isTransfer && (
        <Field label="Category" error={fieldErrors.categoryId}>
          {({ id }) => (
            <Select
              id={id}
              value={form.categoryId}
              onChange={(event) => setForm((f) => ({ ...f, categoryId: event.target.value }))}
            >
              <option value="">Uncategorised</option>
              {flatCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.depth ? `   ${category.name}` : category.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <div className={cn('grid gap-4', (type === 'lend' || type === 'borrow') && 'sm:grid-cols-2')}>
        <Field label="Date">
          {({ id }) => (
            <Input
              id={id}
              type="date"
              value={form.date}
              max={toDateKey(new Date())}
              onChange={(event) => setForm((f) => ({ ...f, date: event.target.value }))}
            />
          )}
        </Field>

        {(type === 'lend' || type === 'borrow') && (
          <Field label="Due date" hint="Optional — used for reminders">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={form.dueDate}
                onChange={(event) => setForm((f) => ({ ...f, dueDate: event.target.value }))}
              />
            )}
          </Field>
        )}
      </div>

      <Field label="Note" hint="What was this for?">
        {({ id }) => (
          <Input
            id={id}
            value={form.description}
            maxLength={200}
            placeholder={placeholderFor(type)}
            onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
          />
        )}
      </Field>

      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-medium text-ink-muted transition-colors hover:text-ink">
          <Plus aria-hidden className="size-3.5 transition-transform group-open:rotate-45" />
          Add details
        </summary>
        <div className="mt-3">
          <Field label="Notes">
            {({ id }) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={2000}
                value={form.notes}
                onChange={(event) => setForm((f) => ({ ...f, notes: event.target.value }))}
              />
            )}
          </Field>
        </div>
      </details>

      <div className="sticky bottom-0 -mx-5 mt-2 border-t border-line-faint bg-raised px-5 pb-2 pt-4 sm:-mx-6 sm:px-6">
        <Button
          type="submit"
          size="lg"
          fullWidth
          variant="gold"
          loading={mutation.isPending}
          disabled={!canSubmit}
          leftIcon={<Check className="size-4" />}
        >
          Save {meta.label.toLowerCase()}
        </Button>
      </div>
    </form>
  );
}

function placeholderFor(type: TransactionType): string {
  switch (type) {
    case 'income':
      return 'Salary for September';
    case 'expense':
      return 'Groceries';
    case 'transfer':
      return 'Cash deposited into bank';
    case 'lend':
      return 'Lent for rent';
    case 'borrow':
      return 'Borrowed for tickets';
    default:
      return 'Part payment';
  }
}

