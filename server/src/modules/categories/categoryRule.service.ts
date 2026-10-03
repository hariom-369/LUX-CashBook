import { Types } from 'mongoose';
import type { CategoryRuleDto, CategorySuggestionDto } from '@khata/shared';
import { Category, CategoryRule, type ICategoryRule } from '../../models/index.js';
import type { RequestScope } from '../../middleware/context.js';
import { conflict, notFound } from '../../lib/errors.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';

/**
 * Category rules (§Phase 2). A rule maps a piece of text in the description - or the payee's name -
 * to a category. They exist to *suggest*: nothing here, or anywhere that uses a rule, ever changes
 * a transaction that already exists, and a suggestion is only applied when the user accepts it.
 *
 * Matching is a plain, case-insensitive substring test over a short list of the workspace's own
 * rules. No pattern is ever compiled from user text, so a rule cannot be turned into a
 * regular-expression attack.
 */

/** A rule has to be accepted this many times before the suggestion is shown as high confidence. */
export const HIGH_CONFIDENCE_HITS = 3;

export function toRuleDto(rule: ICategoryRule, categoryName?: string): CategoryRuleDto {
  return {
    id: String(rule._id),
    pattern: rule.pattern,
    field: rule.field,
    categoryId: String(rule.categoryId),
    categoryName,
    kind: rule.kind,
    hits: rule.hits,
    lastUsedAt: rule.lastUsedAt ? rule.lastUsedAt.toISOString() : undefined,
  };
}

async function loadCategory(scope: RequestScope, categoryId: string) {
  if (!Types.ObjectId.isValid(categoryId)) throw notFound('Category');
  const category = await Category.findOne({ _id: categoryId, workspaceId: scope.workspaceId, isArchived: false }).lean();
  if (!category) throw notFound('Category');
  return category;
}

export async function listRules(scope: RequestScope): Promise<CategoryRuleDto[]> {
  const rules = await CategoryRule.find({ workspaceId: scope.workspaceId }).sort({ hits: -1, pattern: 1 }).lean();
  const names = new Map(
    (await Category.find({ _id: { $in: rules.map((r) => r.categoryId) } }).select('name').lean()).map((c) => [String(c._id), c.name]),
  );
  return rules.map((rule) => toRuleDto(rule, names.get(String(rule.categoryId))));
}

export async function createRule(
  scope: RequestScope,
  input: { pattern: string; field?: 'description' | 'payee'; categoryId: string },
  audit: AuditContext,
): Promise<CategoryRuleDto> {
  const category = await loadCategory(scope, input.categoryId);
  const rule = await CategoryRule.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    pattern: input.pattern,
    field: input.field ?? 'description',
    categoryId: category._id,
    kind: category.kind,
  }).catch((err) => {
    if (err?.code === 11000) throw conflict('You already have a rule for that text.', 'RULE_EXISTS');
    throw err;
  });
  await recordAudit(audit, {
    action: 'created',
    entityType: 'CategoryRule',
    entityId: rule._id,
    summary: `Rule: "${rule.pattern}" → ${category.name}`,
  });
  return toRuleDto(rule, category.name);
}

export async function updateRule(
  scope: RequestScope,
  id: string,
  input: { pattern?: string; categoryId?: string },
  audit: AuditContext,
): Promise<CategoryRuleDto> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Rule');
  const rule = await CategoryRule.findOne({ _id: id, workspaceId: scope.workspaceId });
  if (!rule) throw notFound('Rule');
  let categoryName: string | undefined;
  if (input.categoryId) {
    const category = await loadCategory(scope, input.categoryId);
    rule.categoryId = category._id;
    rule.kind = category.kind;
    categoryName = category.name;
  }
  if (input.pattern) rule.pattern = input.pattern;
  await rule.save().catch((err) => {
    if (err?.code === 11000) throw conflict('You already have a rule for that text.', 'RULE_EXISTS');
    throw err;
  });
  await recordAudit(audit, { action: 'updated', entityType: 'CategoryRule', entityId: rule._id, summary: `Updated rule "${rule.pattern}"` });
  if (!categoryName) categoryName = (await Category.findById(rule.categoryId).select('name').lean())?.name;
  return toRuleDto(rule, categoryName);
}

export async function deleteRule(scope: RequestScope, id: string, audit: AuditContext): Promise<void> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Rule');
  const rule = await CategoryRule.findOneAndDelete({ _id: id, workspaceId: scope.workspaceId });
  if (!rule) throw notFound('Rule');
  await recordAudit(audit, { action: 'deleted', entityType: 'CategoryRule', entityId: rule._id, summary: `Removed rule "${rule.pattern}"` });
}

/** The user accepted a suggestion made by this rule: that is the signal that it can be trusted. */
export async function confirmRule(scope: RequestScope, id: string): Promise<CategoryRuleDto> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Rule');
  const rule = await CategoryRule.findOneAndUpdate(
    { _id: id, workspaceId: scope.workspaceId },
    { $inc: { hits: 1 }, $set: { lastUsedAt: new Date() } },
    { new: true },
  );
  if (!rule) throw notFound('Rule');
  const category = await Category.findById(rule.categoryId).select('name').lean();
  return toRuleDto(rule, category?.name);
}

const norm = (text: string | undefined) => (text ?? '').toLowerCase();
/** True when `needle` occurs in `haystack` bounded by non-letters/digits (or the ends) - checked by hand, no pattern is built from the text. */
function isWholeWord(haystack: string, needle: string): boolean {
  const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[at + needle.length])) return true;
    from = at + 1;
  }
}

/**
 * The best rule for this entry, if any: of the rules whose text appears in the entry's description
 * or payee, the longest wins (the most specific). Confidence is "high" only for a rule the user has
 * accepted several times AND that matches as a whole word; anything else is "medium". Returns null
 * when nothing matches - never a guess.
 */
export async function suggestCategory(
  scope: RequestScope,
  input: { description?: string; payee?: string; kind: 'income' | 'expense' },
): Promise<CategorySuggestionDto | null> {
  const description = norm(input.description);
  const payee = norm(input.payee);
  if (!description && !payee) return null;

  const rules = await CategoryRule.find({ workspaceId: scope.workspaceId, kind: input.kind }).lean();
  const matches = rules
    .map((rule) => {
      const haystack = rule.field === 'payee' ? payee : description;
      return haystack && haystack.includes(rule.pattern) ? { rule, whole: isWholeWord(haystack, rule.pattern) } : null;
    })
    .filter((m): m is { rule: (typeof rules)[number]; whole: boolean } => m !== null)
    .sort((a, b) => b.rule.pattern.length - a.rule.pattern.length || b.rule.hits - a.rule.hits);

  const best = matches[0];
  if (!best) return null;
  const category = await Category.findOne({ _id: best.rule.categoryId, workspaceId: scope.workspaceId, isArchived: false }).select('name').lean();
  if (!category) return null; // the category was archived since: a stale rule suggests nothing

  return {
    ruleId: String(best.rule._id),
    categoryId: String(best.rule.categoryId),
    categoryName: category.name,
    pattern: best.rule.pattern,
    confidence: best.rule.hits >= HIGH_CONFIDENCE_HITS && best.whole ? 'high' : 'medium',
  };
}
