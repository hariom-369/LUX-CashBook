import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, ChevronRight, Plus, Sparkles, X } from 'lucide-react';
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
import { useAccounts, useCategories, useLedgerMutation, usePayees, usePeople } from '../../lib/queries';
import { api, ApiRequestError } from '../../lib/api';
import { formatMoney, toDateKey } from '@khata/shared';
import { enqueueOutboxItem, outboxCount, outboxCountFor } from '../../lib/offlineDb';
import { useOfflineStore } from '../../stores/offline.store';
import { useAuthStore } from '../../stores/auth.store';
import { parseQuickEntry, type ParsedQuickEntry } from '../../lib/naturalLanguageEntry';
import { SplitPaymentForm } from './SplitPaymentForm';
import { CategorySuggestion } from './CategorySuggestion';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n/messages/en';

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
const TYPE_OPTIONS: Array<{ type: TransactionType }> = [
  { type: 'income' },
  { type: 'expense' },
  { type: 'transfer' },
  { type: 'lend' },
  { type: 'borrow' },
  { type: 'repayment_received' },
];

type Step = 'type' | 'details' | 'split';

export function QuickAddSheet() {
  const t = useT();
  const open = useUiStore((s) => s.quickAddOpen);
  const setOpen = useUiStore((s) => s.setQuickAddOpen);
  const consumeQuickAddPrefill = useUiStore((s) => s.consumeQuickAddPrefill);

  const [step, setStep] = useState<Step>('type');
  const [type, setType] = useState<TransactionType>('expense');
  const [prefill, setPrefill] = useState<ParsedQuickEntry | null>(null);

  const { data: categories = [] } = useCategories();
  const { data: people = [] } = usePeople({ sortBy: 'recent' });

  // Reset to the first step on every open, so the sheet never resumes a
  // half-finished entry the user has already mentally abandoned. A prefill
  // handed off by the Assistant (§Phase 10) jumps straight to the review
  // step instead, exactly as if the user had typed it into the NL box here.
  useEffect(() => {
    if (open) {
      const handoff = consumeQuickAddPrefill();
      if (handoff) {
        setType(handoff.type);
        setPrefill(handoff);
        setStep('details');
      } else {
        setStep('type');
        setType('expense');
        setPrefill(null);
      }
    }
  }, [open, consumeQuickAddPrefill]);

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title={step === 'type' ? t('quickAdd.title') : step === 'split' ? t('transactions.splitAPayment') : t.label('txType', type, TRANSACTION_META[type].label)}
      description={step === 'type' ? t('quickAdd.description') : undefined}
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
          onPickSplit={() => setStep('split')}
        />
      ) : step === 'split' ? (
        <SplitPaymentForm onBack={() => setStep('type')} onDone={() => setOpen(false)} />
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
  onPickSplit,
}: {
  categories: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string }>;
  onPick: (type: TransactionType) => void;
  onParsed: (parsed: ParsedQuickEntry) => void;
  onPickSplit: () => void;
}) {
  const t = useT();
  const [nlText, setNlText] = useState('');
  const { data: accounts = [] } = useAccounts();

  function handleParse() {
    if (!nlText.trim()) return;
    const parsed = parseQuickEntry(nlText, { categories, people, accounts });
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
          {t('transactions.typeItInstead')}
        </label>
        <div className="mt-2 flex gap-2">
          <Input
            id="nl-quick-entry"
            value={nlText}
            placeholder={t('transactions.eGPaid250ForLunch')}
            onChange={(event) => setNlText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleParse();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={handleParse} disabled={!nlText.trim()}>
            {t('transactions.go')}
          </Button>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
          {t('transactions.weLlFillInTheType')}
        </p>
      </div>

      <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        <span className="h-px flex-1 bg-line-faint" />
        {t('quickAdd.chooseDirectly')}
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
                  <span className="block text-[14px] font-semibold text-ink">{t(`quickAdd.type.${option.type}.label` as MessageKey)}</span>
                  <span className="block truncate text-[12px] text-ink-muted">{t(`quickAdd.type.${option.type}.hint` as MessageKey)}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={onPickSplit}
        className="flex w-full items-center gap-3.5 rounded-lg border border-dashed border-line bg-transparent p-3.5 text-left transition-colors hover:border-line-strong hover:bg-sunken"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-neutral-soft text-ink-secondary">
          <Icon name="SquareSplitHorizontal" aria-hidden className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-ink">{t('transactions.splitAPayment')}</span>
          <span className="block truncate text-[12px] text-ink-muted">{t('transactions.onePaymentSeveralCategoriesStillOne')}</span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
      </button>
    </div>
  );
}

interface FormState {
  amountMinor: number | null;
  accountId: string;
  toAccountId: string;
  categoryId: string;
  payeeId: string;
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
  const t = useT();
  const toast = useToast();
  const currency = useCurrency();
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const money = (amountMinor: number) => formatMoney(amountMinor, { currency, compactDecimals: true });
  const meta = TRANSACTION_META[type];
  const isTransfer = meta.isTransfer;
  const isPersonal = meta.isPersonal;
  const isRepayment = type === 'repayment_given' || type === 'repayment_received';
  const categoryKind = meta.isIncome ? 'income' : 'expense';

  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories(isPersonal ? undefined : categoryKind);
  const { data: people = [] } = usePeople({ sortBy: 'recent' });
  const { data: payees = [] } = usePayees();

  const [form, setForm] = useState<FormState>(() => ({
    amountMinor: prefill?.amountMinor ?? null,
    accountId: prefill?.accountId ?? '',
    toAccountId: prefill?.toAccountId ?? '',
    categoryId: prefill?.categoryId ?? '',
    payeeId: '',
    personId: prefill?.personId ?? '',
    date: prefill?.date ?? toDateKey(new Date()),
    description: prefill?.matched ? prefill.description : '',
    notes: '',
    dueDate: '',
    repayDirection: 'received',
  }));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Account questions go away once the person has chosen; person and amount ones as soon as they are filled.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const markAnswered = (field: string) => setAnswered((current) => new Set(current).add(field));
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  // Default the account once the list loads: for spending, the cash account people
  // actually reach for; otherwise the first account.
  useEffect(() => {
    if (form.accountId || accounts.length === 0) return;
    const preferred =
      (meta.direction === 'out' ? accounts.find((a) => a.type === 'cash') : undefined) ?? accounts[0];
    setForm((current) => ({
      ...current,
      accountId: preferred?.id ?? '',
      toAccountId: current.toAccountId || (accounts.find((a) => a.id !== preferred?.id)?.id ?? ''),
    }));
  }, [accounts, form.accountId, meta.direction]);

  // What the sentence left unsaid, as questions - only while each is still unanswered.
  const openQuestions = (prefill?.questions ?? []).filter((question) => {
    if (question.field === 'amount') return !form.amountMinor;
    if (question.field === 'person') return !form.personId;
    return !answered.has(question.field);
  });

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
      throw new ApiRequestError(422, { code: 'INVALID_AMOUNT', message: t('transactions.enterAnAmountGreaterThanZero') });
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
        payeeId: isPersonal || isTransfer ? undefined : form.payeeId || undefined,
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
      const result = (await mutation.mutateAsync(undefined as never)) as { id?: string };
      // A receipt failing to attach never undoes the already-saved entry —
      // it's recorded with a toast, not treated as the submit failing.
      if (receiptFile && result?.id) {
        try {
          const receiptForm = new FormData();
          receiptForm.append('file', receiptFile);
          receiptForm.append('transactionId', result.id);
          await api.post('/attachments', receiptForm);
        } catch {
          toast.error(t('transactions.savedButTheReceiptCouldNot'), t('transactions.youCanAddItFromThe'));
        }
      }
      toast.success(t('transactions.saved', { label: t.label('txType', type, meta.label) }), t('transactions.amountRecorded', { amount: money(form.amountMinor ?? 0) }));
      onDone();
    } catch (err) {
      // Offline: the entry isn't lost, it's queued (§39) — this is the one case
      // where a failed request is still a successful save from the user's point
      // of view, so it gets the success toast, not the error one.
      if (err instanceof ApiRequestError && err.isOffline) {
        try {
          const { path, body } = buildRequest();
          await enqueueOutboxItem({
            method: 'POST',
            path,
            body,
            workspaceId: activeWorkspaceId ?? '',
            userId: currentUserId ?? undefined,
          });
          useOfflineStore.getState().setPendingCount(
            currentUserId ? await outboxCountFor(currentUserId) : await outboxCount(),
          );
          toast.success(t('transactions.savedOffline', { label: meta.label }), t('transactions.itLlSyncAutomaticallyOnceYou'));
          onDone();
        } catch (queueErr) {
          setError(queueErr instanceof Error ? queueErr.message : t('transactions.couldNotSaveThatOnThis'));
        }
        return;
      }

      if (err instanceof ApiRequestError && err.fields.length) {
        setFieldErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : t('transactions.couldNotSaveThatPleaseTry'));
      }
    }
  }

  const canSubmit =
    Boolean(form.amountMinor && form.amountMinor > 0 && form.accountId) &&
    (!isPersonal || Boolean(form.personId)) &&
    (!isTransfer || Boolean(form.toAccountId && form.toAccountId !== form.accountId));

  // The save button is disabled until the entry is valid; this says why, for anyone who
  // cannot see which field is still empty (the button is described by it).
  const missing = [
    !(form.amountMinor && form.amountMinor > 0) ? t('reminders.form.amount') : null,
    !form.accountId ? t('common.account') : null,
    isPersonal && !form.personId ? t('common.person') : null,
    isTransfer && !(form.toAccountId && form.toAccountId !== form.accountId) ? t('common.toAccount') : null,
  ].filter((x): x is string => x !== null);
  const needsId = 'quick-add-needs';

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
        {t('transactions.changeType')}
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
            {t('transactions.filledInFromWhatYouTyped')}
          </span>
        </div>
      )}

      {openQuestions.length > 0 && (
        <ul role="status" aria-label={t('transactions.quickQuestions')} className="flex flex-col gap-1 rounded-md border border-line bg-sunken/60 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-secondary">
          {openQuestions.map((question) => (
            <li key={question.field}>{t(`transactions.question.${question.field}`)}</li>
          ))}
        </ul>
      )}

      {/* The amount is the reason the sheet is open, so it leads and takes focus. */}
      <Field label={t('reminders.form.amount')} error={fieldErrors.amountMinor} required>
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
          label={type === 'borrow' ? t('transactions.borrowedFrom') : type === 'lend' ? t('transactions.givenTo') : t('common.person')}
          error={fieldErrors.personId}
          required
          hint={
            selectedPerson && selectedPerson.balanceMinor !== 0
              ? selectedPerson.balanceMinor > 0
                ? t('people.nameOwesYouAmount', { name: selectedPerson.name, amount: money(selectedPerson.balanceMinor) })
                : t('people.youOweNameAmount', { name: selectedPerson.name, amount: money(-selectedPerson.balanceMinor) })
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
              <option value="">{t('transactions.chooseAPerson')}</option>
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
        <Field label={t('common.direction')}>
          {({ id }) => (
            <div id={id} className="grid grid-cols-2 gap-2">
              {(
                [
                  ['received', t('people.theyPaidMe')],
                  ['given', t('people.iPaidThem')],
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

      <div className={cn('grid grid-cols-1 gap-4', isTransfer && 'sm:grid-cols-2')}>
        <Field label={isTransfer ? t('goals.fromAccount') : t('common.account')} error={fieldErrors.accountId} required>
          {({ id }) => (
            <Select
              id={id}
              value={form.accountId}
              onChange={(event) => {
                markAnswered('account');
                setForm((f) => ({ ...f, accountId: event.target.value }));
              }}
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
          <Field label={t('common.toAccount')} error={fieldErrors.toAccountId} required>
            {({ id }) => (
              <Select
                id={id}
                value={form.toAccountId}
                onChange={(event) => {
                  markAnswered('toAccount');
                  setForm((f) => ({ ...f, toAccountId: event.target.value }));
                }}
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
          {t('transactions.movingMoneyBetweenYourOwnAccounts')}
        </p>
      )}

      {!isPersonal && !isTransfer && (
        <Field label={t('common.payee')} hint={t('transactions.optionalKhataRemembersItsUsualAccount')}>
          {({ id }) => (
            <Select
              id={id}
              value={form.payeeId}
              onChange={(event) => {
                const payeeId = event.target.value;
                const payee = payees.find((p) => p.id === payeeId);
                setForm((f) => ({
                  ...f,
                  payeeId,
                  // Only fills in what's still empty — never overwrites a choice
                  // the user already made.
                  accountId: !f.accountId && payee?.defaultAccountId ? payee.defaultAccountId : f.accountId,
                  categoryId: !f.categoryId && payee?.defaultCategoryId ? payee.defaultCategoryId : f.categoryId,
                }));
              }}
            >
              <option value="">{t('transactions.noPayee')}</option>
              {payees.map((payee) => (
                <option key={payee.id} value={payee.id}>
                  {payee.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      {!isPersonal && !isTransfer && (
        <Field label={t('common.category')} error={fieldErrors.categoryId}>
          {({ id }) => (
            <Select
              id={id}
              value={form.categoryId}
              onChange={(event) => setForm((f) => ({ ...f, categoryId: event.target.value }))}
            >
              <option value="">{t('common.uncategorised')}</option>
              {flatCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.depth ? `\u00A0\u00A0\u00A0${category.name}` : category.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      {!isPersonal && !isTransfer && (
        <CategorySuggestion
          kind={categoryKind}
          description={form.description}
          payeeName={payees.find((p) => p.id === form.payeeId)?.name}
          categoryId={form.categoryId}
          categoryName={flatCategories.find((c) => c.id === form.categoryId)?.name}
          onUse={(categoryId) => setForm((f) => ({ ...f, categoryId }))}
        />
      )}

      <div className={cn('grid grid-cols-1 gap-4', (type === 'lend' || type === 'borrow') && 'sm:grid-cols-2')}>
        <Field label={t('common.date')}>
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
          <Field label={t('reminders.form.due')} hint={t('transactions.optionalUsedForReminders')}>
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

      <Field label={t('common.note')} hint={t('transactions.whatWasThisFor')}>
        {({ id }) => (
          <Input
            id={id}
            value={form.description}
            maxLength={200}
            placeholder={placeholderFor(type, t)}
            onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
          />
        )}
      </Field>

      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-medium text-ink-muted transition-colors hover:text-ink">
          <Plus aria-hidden className="size-3.5 transition-transform group-open:rotate-45" />
          {t('transactions.addDetails')}
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <Field label={t('common.notes')}>
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

          <Field label={t('common.receipt')} hint={t('transactions.attachedOnceThisEntryIsSaved')}>
            {({ id }) => (
              <div className="flex items-center gap-2">
                <input
                  id={id}
                  ref={receiptInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  capture="environment"
                  className="hidden"
                  tabIndex={-1}
                  onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<Camera className="size-3.5" />}
                  onClick={() => receiptInputRef.current?.click()}
                >
                  {receiptFile ? t('transactions.changeReceipt') : t('transactions.attachReceipt')}
                </Button>
                {receiptFile && (
                  <>
                    <span className="min-w-0 truncate text-[12px] text-ink-muted">{receiptFile.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setReceiptFile(null);
                        if (receiptInputRef.current) receiptInputRef.current.value = '';
                      }}
                      aria-label={t('transactions.removeReceipt')}
                      className="rounded-sm p-1 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </>
                )}
              </div>
            )}
          </Field>
        </div>
      </details>

      {/*
        Sticky offsets are measured inside the sheet body's 1.25rem bottom padding,
        so `-bottom-5` pins the bar to the real edge — otherwise, when the form
        scrolls (short or landscape phones, keyboard open), fields show through
        beneath it. The matching `-mb-5` and larger padding keep the resting
        spacing identical, and clear the home indicator where there is one.
      */}
      <div className="sticky -bottom-5 -mx-5 -mb-5 mt-2 border-t border-line-faint bg-raised px-5 pb-[max(1.75rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] pt-4 sm:-mx-6 sm:px-6">
        {!canSubmit && missing.length > 0 && (
          <p id={needsId} className="mb-2 text-center text-[12px] text-ink-muted">
            {t('quickAdd.needsToSave', { fields: missing.join(', ') })}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          fullWidth
          variant="gold"
          loading={mutation.isPending}
          disabled={!canSubmit}
          aria-describedby={canSubmit ? undefined : needsId}
          leftIcon={<Check className="size-4" />}
        >
          {t('common.save')} {t.label('txType', type, meta.label).toLowerCase()}
        </Button>
      </div>
    </form>
  );
}

function placeholderFor(type: TransactionType, t: ReturnType<typeof useT>): string {
  switch (type) {
    case 'income':
      return t('quickAdd.placeholder.income');
    case 'expense':
      return t('quickAdd.placeholder.expense');
    case 'transfer':
      return t('quickAdd.placeholder.transfer');
    case 'lend':
      return t('quickAdd.placeholder.lend');
    case 'borrow':
      return t('quickAdd.placeholder.borrow');
    default:
      return t('quickAdd.placeholder.default');
  }
}

