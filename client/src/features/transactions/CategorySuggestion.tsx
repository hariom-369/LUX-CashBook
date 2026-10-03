import { useEffect, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import type { CategorySuggestionDto } from '@khata/shared';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useDebounced } from '../../hooks/useDebounced';
import { api } from '../../lib/api';
import { fetchCategorySuggestion, useInvalidateOrganise } from '../../lib/queries5';
import { useToast } from '../../components/ui/Toast';
import { useT } from '../../i18n';

/**
 * The offer (§Phase 2 category rules) shown next to the category field while an entry is being typed.
 *
 *  - A rule matches and no category is chosen yet: "Suggested: Telecom - from your rule 'jio'" with a
 *    confidence cue, and a button to use it. Nothing is applied until the person presses it.
 *  - No rule matches but the person picked a category themselves: offer to remember that pairing as a
 *    rule - for next time only; saving a rule never touches an entry that already exists.
 */
export function CategorySuggestion({
  kind,
  description,
  payeeName,
  categoryId,
  categoryName,
  onUse,
}: {
  kind: 'income' | 'expense';
  description: string;
  payeeName?: string;
  categoryId: string;
  categoryName?: string;
  onUse: (categoryId: string) => void;
}) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateOrganise();
  const text = useDebounced(description.trim(), 400);
  const payee = useDebounced((payeeName ?? '').trim(), 400);
  const [suggestion, setSuggestion] = useState<CategorySuggestionDto | null>(null);
  const [checked, setChecked] = useState(false);
  const [rulePattern, setRulePattern] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setChecked(false);
    if (text.length < 2 && payee.length < 2) {
      setSuggestion(null);
      setChecked(true);
      return;
    }
    void fetchCategorySuggestion({ description: text || undefined, payee: payee || undefined, kind }).then((result) => {
      if (cancelled) return;
      setSuggestion(result);
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [text, payee, kind]);

  // Default the "remember" text to the longest word typed - the part most likely to identify the merchant.
  useEffect(() => {
    const longest = text.split(/\s+/).sort((a, b) => b.length - a.length)[0] ?? '';
    setRulePattern(longest.toLowerCase().slice(0, 60));
    setSaved(false);
  }, [text]);

  async function use() {
    if (!suggestion) return;
    onUse(suggestion.categoryId);
    // Accepting is what teaches the rule it can be trusted; failing to record that must never block the entry.
    void api.post(`/category-rules/${suggestion.ruleId}/confirm`).then(invalidate, () => undefined);
  }

  async function remember() {
    setSaving(true);
    try {
      await api.post('/category-rules', { pattern: rulePattern, categoryId });
      invalidate();
      setSaved(true);
      toast.success(t('rules.added'));
    } catch {
      toast.error(t('suggest.couldNotSave'));
    } finally {
      setSaving(false);
    }
  }

  if (!checked) return null;

  if (suggestion && !categoryId) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-gold/25 bg-gold-soft px-3.5 py-2.5 text-[12.5px] text-gold-strong">
        <Lightbulb aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          {t('suggest.suggested', { category: suggestion.categoryName })}{' '}
          <span className="text-ink-secondary">
            {t('suggest.fromRule', { pattern: suggestion.pattern })} · {suggestion.confidence === 'high' ? t('suggest.high') : t('suggest.medium')}
          </span>
        </span>
        <Button type="button" size="sm" variant="secondary" onClick={() => void use()}>
          {t('suggest.use')}
        </Button>
      </div>
    );
  }

  if (!suggestion && categoryId && text.length >= 3 && rulePattern.length >= 2 && !saved) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
        <label htmlFor="rule-pattern" className="shrink-0">
          {t('suggest.remember', { category: categoryName ?? '' })}
        </label>
        <Input
          id="rule-pattern"
          value={rulePattern}
          onChange={(event) => setRulePattern(event.target.value.toLowerCase())}
          maxLength={60}
          className="h-8 w-40 text-[12.5px]"
        />
        <Button type="button" size="sm" variant="ghost" loading={saving} onClick={() => void remember()}>
          {t('suggest.saveRule')}
        </Button>
      </div>
    );
  }

  return null;
}
