import { useT } from '../../i18n';
import { CategoryRulesSettings } from './CategoryRulesSettings';
import { TagsSettings } from './TagsSettings';

/** Settings → Tags & rules: the two ways to keep entries tidy (§Phase 2). */
export function OrganiseSettings() {
  const t = useT();
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="tags-heading" className="flex flex-col gap-1">
        <h2 id="tags-heading" className="sr-only">
          {t('tags.title')}
        </h2>
        <TagsSettings />
      </section>
      <section aria-labelledby="rules-heading" className="flex flex-col gap-1 border-t border-line pt-8">
        <h2 id="rules-heading" className="sr-only">
          {t('rules.title')}
        </h2>
        <CategoryRulesSettings />
      </section>
    </div>
  );
}
