import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Calculator, Clock, Copy, Delete, Divide, Equal, Info, Minus, Percent, Plus, Trash2, X } from 'lucide-react';
import { currencyMeta, formatDate, formatTime, isSameDay } from '@khata/shared';
import { Sheet } from './ui/Sheet';
import { Field, Input } from './ui/Input';
import { useToast } from './ui/Toast';
import { cn } from '../lib/cn';
import {
  appendKey,
  evaluate,
  formatCalculatorNumber,
  insertValue,
  toggleSign,
  type CalculatorError,
  type CalculatorKey,
} from '../lib/calculator';
import { useCurrency } from '../hooks/useCurrency';
import { useAuthStore } from '../stores/auth.store';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n/messages/en';

/**
 * The Quick Calculator: a scratchpad for sums — splitting a bill, adding GST, checking a
 * total. It never reads or changes a transaction, balance or any other record. The only
 * thing it keeps is its own history of worked-out sums, in this browser's storage (per
 * user, never sent anywhere), and a memory value that lasts until the page is reloaded.
 */

type Tab = 'standard' | 'percentage';

export function QuickCalculator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('standard');

  const title = (
    <span className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-gold-soft text-gold-strong">
        <Calculator aria-hidden className="size-[18px]" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span>{t('calculator.title')}</span>
        <span className="text-[12.5px] font-normal tracking-normal text-ink-muted">{t('calculator.subtitle')}</span>
      </span>
    </span>
  );

  const tabs: Array<{ id: Tab; label: MessageKey; icon: ReactNode }> = [
    { id: 'standard', label: 'calculator.tab.standard', icon: <Calculator aria-hidden className="size-4" /> },
    { id: 'percentage', label: 'calculator.tab.percentage', icon: <Percent aria-hidden className="size-4" /> },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      ariaLabel={t('calculator.title')}
      size="xl"
      className="sm:max-w-3xl"
      footer={
        <div role="tablist" aria-label={t('calculator.modes')} className="-my-1 flex gap-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                'flex h-10 items-center gap-2 border-b-2 px-3 text-[13px] font-medium transition-colors',
                tab === item.id ? 'border-gold text-gold-strong' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'standard' ? <StandardCalculator /> : <PercentageTools />}
    </Sheet>
  );
}

// ─────────────────────────────────────────────── Standard

type Action = CalculatorKey | 'backspace' | 'equals' | 'sign';

interface KeyDef {
  action: Action;
  glyph: ReactNode;
  /** Spoken name; digits read as themselves. */
  name?: MessageKey;
  tone: 'digit' | 'function' | 'operator' | 'equals';
}

const icon = 'size-[18px]';
const TOP_ROW: KeyDef[] = [
  { action: '%', glyph: <Percent aria-hidden className={icon} />, name: 'calculator.percent', tone: 'function' },
  { action: '(', glyph: '(', name: 'calculator.openBracket', tone: 'function' },
  { action: ')', glyph: ')', name: 'calculator.closeBracket', tone: 'function' },
  { action: 'backspace', glyph: <Delete aria-hidden className={icon} />, name: 'calculator.backspace', tone: 'function' },
  { action: '/', glyph: <Divide aria-hidden className={icon} />, name: 'calculator.divide', tone: 'operator' },
];
const MAIN_KEYS: KeyDef[] = [
  { action: '7', glyph: '7', tone: 'digit' },
  { action: '8', glyph: '8', tone: 'digit' },
  { action: '9', glyph: '9', tone: 'digit' },
  { action: '*', glyph: <X aria-hidden className={icon} />, name: 'calculator.multiply', tone: 'operator' },
  { action: '4', glyph: '4', tone: 'digit' },
  { action: '5', glyph: '5', tone: 'digit' },
  { action: '6', glyph: '6', tone: 'digit' },
  { action: '-', glyph: <Minus aria-hidden className={icon} />, name: 'calculator.subtract', tone: 'operator' },
  { action: '1', glyph: '1', tone: 'digit' },
  { action: '2', glyph: '2', tone: 'digit' },
  { action: '3', glyph: '3', tone: 'digit' },
  { action: '+', glyph: <Plus aria-hidden className={icon} />, name: 'calculator.add', tone: 'operator' },
  { action: 'sign', glyph: '±', name: 'calculator.toggleSign', tone: 'digit' },
  { action: '0', glyph: '0', tone: 'digit' },
  { action: '.', glyph: '.', name: 'calculator.decimalPoint', tone: 'digit' },
  { action: 'equals', glyph: <Equal aria-hidden className="size-5" />, name: 'calculator.equals', tone: 'equals' },
];

const KEY_TONE: Record<KeyDef['tone'], string> = {
  digit: 'border border-line bg-surface text-ink hover:bg-sunken',
  function: 'bg-sunken text-ink-secondary hover:text-ink',
  operator: 'bg-sunken text-ink hover:bg-line-faint',
  equals: 'bg-gold text-ink-inverse hover:bg-gold/90',
};

/** Keyboard → keypad. Enter and = calculate; Escape is left to the sheet, which closes. */
function actionForKey(key: string): Action | 'clear' | null {
  if (/^[0-9]$/.test(key) || ['.', '+', '-', '*', '/', '%', '(', ')'].includes(key)) return key as CalculatorKey;
  switch (key) {
    case ',':
      return '.';
    case 'x':
    case 'X':
      return '*';
    case 'Enter':
    case '=':
      return 'equals';
    case 'Backspace':
      return 'backspace';
    case 'Delete':
    case 'c':
    case 'C':
      return 'clear';
    default:
      return null;
  }
}

const ERROR_MESSAGE: Record<CalculatorError, MessageKey> = {
  empty: 'calculator.error.invalid',
  invalid: 'calculator.error.invalid',
  divideByZero: 'calculator.error.divideByZero',
  tooLong: 'calculator.error.tooLong',
};

interface HistoryEntry {
  expression: string;
  value: string;
  at: string;
}

const HISTORY_LIMIT = 50;
const historyKey = (userId: string | null) => `khata.calculatorHistory.${userId ?? 'guest'}`;

/** Browser storage can be missing or throw (private windows, blocked site data): history then simply isn't kept. */
function loadHistory(key: string): HistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed)
      ? parsed
          .filter((e): e is HistoryEntry => typeof e?.expression === 'string' && typeof e?.value === 'string' && typeof e?.at === 'string')
          .slice(0, HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}
function saveHistory(key: string, entries: HistoryEntry[]) {
  try {
    if (entries.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    /* not kept */
  }
}

/** Held for the session only — gone on reload, and never stored. */
let sessionMemory: string | null = null;

function StandardCalculator() {
  const t = useT();
  const toast = useToast();
  const grouping = currencyMeta(useCurrency()).grouping;
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const storageKey = historyKey(userId);

  const [expression, setExpression] = useState('');
  /** Set after "=": the sum that was worked out and its answer. */
  const [answer, setAnswer] = useState<{ expression: string; value: string } | null>(null);
  const [error, setError] = useState<CalculatorError | null>(null);
  const [memory, setMemoryState] = useState<string | null>(sessionMemory);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory(storageKey));

  const setMemory = (value: string | null) => {
    sessionMemory = value;
    setMemoryState(value);
  };

  const number = (text: string) => formatCalculatorNumber(text, grouping);
  const display = (text: string) =>
    text
      .replace(/(\d+)(\.\d*)?/g, (_, whole: string, fraction?: string) => number(whole) + (fraction ?? ''))
      .replace(/\*/g, '×')
      .replace(/\//g, '÷')
      .replace(/-/g, '−');

  // The answer so far: the typed sum's value, or — mid-operator — the value before it.
  const live = useMemo(() => {
    if (answer) return answer.value;
    const whole = evaluate(expression);
    if (whole.ok) return whole.value;
    const settled = evaluate(expression.replace(/[+\-*/(]+$/, ''));
    return settled.ok ? settled.value : null;
  }, [expression, answer]);

  const copyText = useCallback(
    async (text: string | null) => {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t('calculator.copied'), text);
      } catch {
        toast.error(t('calculator.couldNotCopy'));
      }
    },
    [t, toast],
  );

  const remember = useCallback(
    (entry: HistoryEntry) => {
      setHistory((current) => {
        const next = [entry, ...current].slice(0, HISTORY_LIMIT);
        saveHistory(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const press = useCallback(
    (action: Action | 'clear') => {
      setError(null);
      if (action === 'clear') {
        setExpression('');
        setAnswer(null);
        return;
      }
      if (action === 'backspace') {
        // After "=", backspace takes you back to editing the sum that produced the answer.
        if (answer) {
          setExpression(answer.expression);
          setAnswer(null);
        } else {
          setExpression((current) => current.slice(0, -1));
        }
        return;
      }
      if (action === 'equals') {
        if (answer) return;
        const result = evaluate(expression);
        if (result.ok) {
          setAnswer({ expression, value: result.value });
          remember({ expression, value: result.value, at: new Date().toISOString() });
        } else if (result.error !== 'empty') {
          setError(result.error);
        }
        return;
      }
      if (action === 'sign') {
        setExpression(toggleSign(answer ? answer.value : expression));
        setAnswer(null);
        return;
      }
      if (answer) {
        // An operator carries on from the answer; anything else starts a new sum.
        const continues = ['+', '-', '*', '/', '%'].includes(action);
        setExpression(appendKey(continues ? answer.value : '', action));
        setAnswer(null);
        return;
      }
      setExpression((current) => appendKey(current, action));
    },
    [answer, expression, remember],
  );

  function memoryAction(kind: 'clear' | 'recall' | 'add' | 'subtract' | 'store') {
    setError(null);
    if (kind === 'clear') return setMemory(null);
    if (kind === 'recall') {
      if (memory === null) return;
      setExpression(insertValue(answer ? '' : expression, memory));
      setAnswer(null);
      return;
    }
    if (live === null) return;
    if (kind === 'store') return setMemory(live);
    const next = evaluate(`${memory ?? '0'}${kind === 'add' ? '+' : '-'}(${live})`);
    if (next.ok) setMemory(next.value);
  }

  // Keyboard input. Captured at the window so the app's own single-key shortcuts don't also
  // fire; keys the calculator doesn't use (Tab, Escape…) pass through untouched.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
        event.preventDefault();
        event.stopPropagation();
        void copyText(live);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const action = actionForKey(event.key);
      if (!action) return;
      event.preventDefault(); // stops Enter also "clicking" whichever key has focus
      event.stopPropagation();
      press(action);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [press, copyText, live]);

  const big = live !== null ? number(live) : '0';
  const bigSize = big.length > 22 ? 'text-[20px]' : big.length > 14 ? 'text-[26px]' : 'text-[34px]';
  const now = new Date();

  const memoryKeys: Array<{ kind: Parameters<typeof memoryAction>[0]; glyph: string; name: MessageKey; needsMemory?: boolean }> = [
    { kind: 'clear', glyph: 'MC', name: 'calculator.memory.clear', needsMemory: true },
    { kind: 'recall', glyph: 'MR', name: 'calculator.memory.recall', needsMemory: true },
    { kind: 'add', glyph: 'M+', name: 'calculator.memory.add' },
    { kind: 'subtract', glyph: 'M−', name: 'calculator.memory.subtract' },
    { kind: 'store', glyph: 'MS', name: 'calculator.memory.store' },
  ];

  const keyButton = (k: KeyDef, extra?: string) => (
    <button
      key={k.action}
      type="button"
      onClick={() => press(k.action)}
      aria-label={k.name ? t(k.name) : String(k.glyph)}
      className={cn(
        'flex items-center justify-center rounded-md text-[17px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[--k-gold-ring]',
        KEY_TONE[k.tone],
        extra,
      )}
    >
      {k.glyph}
    </button>
  );

  return (
    <div className="grid grid-cols-1 gap-4 pb-1 md:grid-cols-[minmax(0,1fr)_16.5rem]">
      <div className="flex min-w-0 flex-col gap-2.5">
        {/* Display */}
        <div className="rounded-lg border border-line bg-surface px-4 pb-3 pt-3 shadow-xs">
          <div className="flex items-start gap-2">
            {memory !== null && (
              <span
                title={t('calculator.memoryHolds', { value: number(memory) })}
                className="mt-0.5 rounded-sm bg-gold-soft px-1.5 text-[10.5px] font-bold text-gold-strong"
              >
                M
              </span>
            )}
            <p className="min-h-[20px] min-w-0 flex-1 break-all text-[13px] text-ink-muted tabular" aria-label={t('calculator.expression')}>
              {answer ? `${display(answer.expression)} =` : display(expression)}
            </p>
            <button
              type="button"
              onClick={() => press('clear')}
              aria-label={t('calculator.clear')}
              title={t('calculator.clear')}
              className="rounded-sm px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
            >
              AC
            </button>
            <button
              type="button"
              onClick={() => void copyText(live)}
              disabled={live === null}
              aria-label={t('calculator.copyResult')}
              title={t('calculator.copyResult')}
              className="rounded-sm p-1 text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"
            >
              <Copy aria-hidden className="size-4" />
            </button>
          </div>
          <output
            aria-live="polite"
            aria-label={t('calculator.result')}
            className={cn('mt-2 block break-all text-right font-semibold leading-tight text-ink tabular', bigSize)}
          >
            {big}
          </output>
          {error && (
            <p role="alert" className="mt-1 text-right text-[12px] font-medium text-negative">
              {t(ERROR_MESSAGE[error])}
            </p>
          )}
        </div>

        {/* Memory */}
        <div className="grid grid-cols-5 gap-1.5">
          {memoryKeys.map((m) => (
            <button
              key={m.kind}
              type="button"
              onClick={() => memoryAction(m.kind)}
              disabled={m.needsMemory && memory === null}
              aria-label={t(m.name)}
              title={t(m.name)}
              className="h-9 rounded-md bg-sunken text-[12px] font-semibold text-ink-secondary transition-colors hover:text-ink disabled:opacity-45"
            >
              {m.glyph}
            </button>
          ))}
        </div>

        {/* Keypad */}
        <div role="group" aria-label={t('calculator.keypad')} className="flex flex-col gap-1.5">
          <div className="grid grid-cols-5 gap-1.5">{TOP_ROW.map((k) => keyButton(k, 'h-11'))}</div>
          <div className="grid grid-cols-4 gap-1.5">{MAIN_KEYS.map((k) => keyButton(k, 'h-12'))}</div>
        </div>
      </div>

      {/* History */}
      <section aria-labelledby="calculator-history" className="flex min-h-0 flex-col rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line-faint px-3.5 py-2.5">
          <h3 id="calculator-history" className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <Clock aria-hidden className="size-4 text-ink-muted" />
            {t('calculator.history')}
          </h3>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setHistory([]);
                saveHistory(storageKey, []);
              }}
              aria-label={t('calculator.clearHistory')}
              className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-[12px] font-medium text-ink-muted transition-colors hover:text-negative"
            >
              {t('calculator.clearShort')}
              <Trash2 aria-hidden className="size-3.5" />
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-[12.5px] text-ink-faint">{t('calculator.noHistory')}</p>
        ) : (
          <ul className="max-h-64 divide-y divide-line-faint overflow-y-auto md:max-h-[19.5rem]">
            {history.map((entry, i) => {
              const at = new Date(entry.at);
              return (
                <li key={`${entry.at}-${i}`} className="flex items-start gap-2 px-3.5 py-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setAnswer({ expression: entry.expression, value: entry.value });
                      setExpression('');
                    }}
                    aria-label={t('calculator.reuse', { value: number(entry.value) })}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block break-all text-[12.5px] text-ink tabular">{display(entry.expression)}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-faint">
                      {isSameDay(at, now) ? formatTime(at) : `${formatDate(at, 'dd MMM')} · ${formatTime(at)}`}
                    </span>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[13px] font-semibold text-positive tabular">{number(entry.value)}</span>
                    <button
                      type="button"
                      onClick={() => void copyText(entry.value)}
                      aria-label={t('calculator.copyValue', { value: number(entry.value) })}
                      className="rounded-sm p-0.5 text-ink-faint transition-colors hover:text-ink"
                    >
                      <Copy aria-hidden className="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="m-3 mt-auto flex gap-2 rounded-md bg-gold-soft px-3 py-2.5 text-[11.5px] leading-snug text-ink-secondary">
          <Info aria-hidden className="mt-px size-3.5 shrink-0 text-gold-strong" />
          {t('calculator.storedLocally')}
        </p>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────── Percentage

const NUMBER_INPUT = /^-?\d*\.?\d*$/;
const isNumber = (s: string) => s !== '' && s !== '-' && s !== '.' && s !== '-.' && NUMBER_INPUT.test(s);

/** The exact result of a sum built from typed numbers — a decimal string, an error code, or null until both are filled in. */
function compute(expression: string | null, digits: number): string | null {
  if (expression === null) return null;
  const result = evaluate(expression, digits);
  return result.ok ? result.value : result.error;
}

function PercentageTools() {
  const t = useT();
  const currency = currencyMeta(useCurrency());
  const [ofPct, setOfPct] = useState('');
  const [ofAmount, setOfAmount] = useState('');
  const [part, setPart] = useState('');
  const [total, setTotal] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [taxAmount, setTaxAmount] = useState('');
  const [taxRate, setTaxRate] = useState('18');

  const both = (a: string, b: string, build: () => string) => (isNumber(a) && isNumber(b) ? build() : null);
  const money = currency.decimals;

  const ofResult = compute(both(ofPct, ofAmount, () => `(${ofAmount})*(${ofPct})/100`), money);
  const partResult = compute(both(part, total, () => `(${part})/(${total})*100`), 2);
  const changeResult = compute(both(from, to, () => `((${to})-(${from}))/(${from})*100`), 2);
  const withTax = compute(both(taxAmount, taxRate, () => `(${taxAmount})*(100+(${taxRate}))/100`), money);
  const withoutTax = compute(both(taxAmount, taxRate, () => `(${taxAmount})*100/(100+(${taxRate}))`), money);

  const field = (label: MessageKey, value: string, set: (v: string) => void, suffix?: string) => (
    <Field label={t(label)}>
      {({ id }) => (
        <div className="relative">
          <Input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              const next = e.target.value.replace(/,/g, '');
              if (NUMBER_INPUT.test(next) && next.length <= 30) set(next);
            }}
            className={suffix ? 'pr-8' : undefined}
          />
          {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint">{suffix}</span>}
        </div>
      )}
    </Field>
  );

  const changeLabel =
    changeResult !== null && /^-?\d/.test(changeResult) && changeResult !== '0'
      ? changeResult.startsWith('-')
        ? t('calculator.pct.decrease')
        : t('calculator.pct.increase')
      : t('calculator.pct.result');

  return (
    <div className="grid grid-cols-1 gap-3 pb-1 sm:grid-cols-2">
      <ToolCard title={t('calculator.pct.ofTitle')}>
        <div className="grid grid-cols-2 gap-2">
          {field('calculator.pct.percent', ofPct, setOfPct, '%')}
          {field('calculator.pct.amount', ofAmount, setOfAmount)}
        </div>
        <ToolResult label={t('calculator.pct.result')} value={ofResult} grouping={currency.grouping} decimals={money} />
      </ToolCard>

      <ToolCard title={t('calculator.pct.isWhatTitle')}>
        <div className="grid grid-cols-2 gap-2">
          {field('calculator.pct.part', part, setPart)}
          {field('calculator.pct.total', total, setTotal)}
        </div>
        <ToolResult label={t('calculator.pct.result')} value={partResult} grouping={currency.grouping} suffix="%" />
      </ToolCard>

      <ToolCard title={t('calculator.pct.changeTitle')}>
        <div className="grid grid-cols-2 gap-2">
          {field('calculator.pct.from', from, setFrom)}
          {field('calculator.pct.to', to, setTo)}
        </div>
        <ToolResult label={changeLabel} value={changeResult} grouping={currency.grouping} suffix="%" />
      </ToolCard>

      <ToolCard title={t('calculator.pct.taxTitle')}>
        <div className="grid grid-cols-2 gap-2">
          {field('calculator.pct.amount', taxAmount, setTaxAmount)}
          {field('calculator.pct.rate', taxRate, setTaxRate, '%')}
        </div>
        <ToolResult label={t('calculator.pct.withTax')} value={withTax} grouping={currency.grouping} decimals={money} />
        <ToolResult label={t('calculator.pct.withoutTax')} value={withoutTax} grouping={currency.grouping} decimals={money} />
      </ToolCard>
    </div>
  );
}

function ToolCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-3.5">
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function padFraction(value: string, decimals: number): string {
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(decimals, '0')}`;
}

function ToolResult({
  label,
  value: raw,
  grouping,
  suffix = '',
  decimals,
}: {
  label: string;
  value: string | null;
  grouping: 'indian' | 'western';
  suffix?: string;
  /** Money: always show the currency's decimal places (1,392.40, not 1,392.4). */
  decimals?: number;
}) {
  const t = useT();
  const toast = useToast();
  const isValue = raw !== null && /^-?\d/.test(raw);
  const value = isValue && decimals ? padFraction(raw, decimals) : (raw ?? '');
  const shown = isValue ? `${formatCalculatorNumber(value, grouping)}${suffix}` : null;

  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-sunken px-3 py-2">
      <span className="text-[12px] text-ink-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <output className={cn('break-all text-right text-[14px] font-semibold tabular', isValue ? 'text-ink' : 'text-ink-faint')}>
          {shown ?? (raw === 'divideByZero' ? t('calculator.error.divideByZero') : '—')}
        </output>
        {isValue && (
          <button
            type="button"
            onClick={() => {
              // Inside a promise, so a browser with no clipboard at all lands in the error toast too.
              Promise.resolve()
                .then(() => navigator.clipboard.writeText(value))
                .then(
                  () => toast.success(t('calculator.copied'), value),
                  () => toast.error(t('calculator.couldNotCopy')),
                );
            }}
            aria-label={t('calculator.copyValue', { value: shown ?? '' })}
            className="rounded-sm p-0.5 text-ink-faint transition-colors hover:text-ink"
          >
            <Copy aria-hidden className="size-3.5" />
          </button>
        )}
      </span>
    </div>
  );
}
