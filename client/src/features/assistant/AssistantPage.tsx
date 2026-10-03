import { useRef, useState } from 'react';
import { Bot, Camera, Sparkles } from 'lucide-react';
import type { TransactionDraftDto } from '@khata/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Input';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useUiStore } from '../../stores/ui.store';
import { useCurrency } from '../../hooks/useCurrency';
import { formatMoney } from '@khata/shared';
import { useAiStatus } from '../../lib/queries3';
import { api, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

/**
 * AI assistant (§Phase 10, decision 7).
 *
 * Two things live on this one page: asking a read-only question about your
 * own data, and turning a description or receipt photo into a *draft* —
 * never saved from here. A draft always hands off to the ordinary Quick Add
 * review screen (`ui.store#openQuickAddWithPrefill`), the same screen a
 * manually-typed entry goes through, so a misread amount or category gets
 * caught before anything is recorded.
 */
export function AssistantPage() {
  const t = useT();
  const { data: status, isLoading } = useAiStatus();
  const toast = useToast();
  const currency = useCurrency();
  const openQuickAddWithPrefill = useUiStore((s) => s.openQuickAddWithPrefill);

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<TransactionDraftDto | null>(null);
  const [extracting, setExtracting] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  async function ask() {
    if (!question.trim()) return;
    setAsking(true);
    setAnswer(null);
    try {
      const res = await api.post<{ answer: string }>('/ai/ask', { question });
      setAnswer(res.answer);
    } catch (err) {
      toast.error(t('assistant.couldnTGetAnAnswer'), errorMessage(err));
    } finally {
      setAsking(false);
    }
  }

  async function extractFromText() {
    if (!description.trim()) return;
    setExtracting(true);
    setDraft(null);
    try {
      setDraft(await api.post<TransactionDraftDto>('/ai/draft', { text: description }));
    } catch (err) {
      toast.error(t('assistant.couldnTReadThat'), errorMessage(err));
    } finally {
      setExtracting(false);
    }
  }

  async function extractFromReceipt(file: File) {
    setExtracting(true);
    setDraft(null);
    try {
      const body = new FormData();
      body.append('file', file);
      setDraft(await api.post<TransactionDraftDto>('/ai/draft/receipt', body));
    } catch (err) {
      toast.error(t('assistant.couldnTReadThatReceipt'), errorMessage(err));
    } finally {
      setExtracting(false);
      if (receiptInputRef.current) receiptInputRef.current.value = '';
    }
  }

  function useDraft() {
    if (!draft) return;
    openQuickAddWithPrefill({
      type: draft.type,
      amountMinor: draft.amountMinor,
      date: draft.date.slice(0, 10),
      description: draft.description,
      categoryId: draft.categoryId ?? undefined,
      accountId: draft.accountId ?? undefined,
      questions: [],
      matched: true,
    });
    setDraft(null);
    setDescription('');
  }

  if (isLoading) return null;

  if (!status?.configured) {
    return (
      <div className="flex flex-col gap-5">
        <Header />
        <Card bare>
          <EmptyState
            icon={<Bot className="size-5" />}
            title={t('assistant.theAiAssistantIsnTConfigured')}
            description={t('assistant.thisIsAnOptionalFeatureAsk')}
          />
        </Card>
      </div>
    );
  }

  if (!status.consentGiven) {
    return (
      <div className="flex flex-col gap-5">
        <Header />
        <Card bare>
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title={t('assistant.turnOnTheAssistantToUse')}
            description={t('assistant.itSOffByDefaultBecause')}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Header />

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-[14px] font-medium text-ink">{t('assistant.askAboutYourFinances')}</h2>
        <Textarea
          rows={2}
          placeholder={t('assistant.eGHowMuchDidI')}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div>
          <Button size="sm" onClick={() => void ask()} loading={asking} disabled={!question.trim()}>
            {t('assistant.ask')}
          </Button>
        </div>
        {answer && (
          <p className="sensitive rounded-md border border-line-faint bg-sunken px-3.5 py-3 text-[13.5px] leading-relaxed text-ink-secondary">
            {answer}
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-[14px] font-medium text-ink">{t('assistant.describeATransaction')}</h2>
        <Textarea
          rows={2}
          placeholder={t('assistant.eGPaid450ForGroceries')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void extractFromText()} loading={extracting} disabled={!description.trim()}>
            {t('assistant.createADraft')}
          </Button>
          <input
            ref={receiptInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void extractFromReceipt(file);
            }}
          />
          <Button size="sm" variant="secondary" leftIcon={<Camera className="size-3.5" />} onClick={() => receiptInputRef.current?.click()} loading={extracting}>
            {t('assistant.scanAReceipt')}
          </Button>
        </div>

        {draft && (
          <div className="flex flex-col gap-2 rounded-md border border-gold/25 bg-gold-soft px-3.5 py-3 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">{draft.description}</span>
              <span className="sensitive font-semibold text-ink">{formatMoney(draft.amountMinor, { currency })}</span>
            </div>
            <p className="text-[12px] text-ink-muted">
              {draft.type === 'income' ? t('common.moneyIn') : t('common.moneyOut')}
              {draft.categoryName ? ` · ${draft.categoryName}${draft.matched.category ? '' : ' (not an existing category)'}` : ''}
              {draft.accountName ? ` · ${draft.accountName}${draft.matched.account ? '' : ' (not an existing account)'}` : ''}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" variant="gold" onClick={useDraft}>
                {t('assistant.reviewSave')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                {t('assistant.discard')}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Header() {
  const t = useT();
  return (
    <header>
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.015em] text-ink">
        <Bot className="size-5 text-gold" aria-hidden />
        {t('nav.assistant')}
      </h1>
      <p className="mt-0.5 text-[13px] text-ink-muted">
        {t('assistant.askQuestionsAboutYourOwnData')}
      </p>
    </header>
  );
}

