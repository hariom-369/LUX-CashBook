import type { AiStatusDto, TransactionDraftDto } from '@khata/shared';
import { Account, Category, User } from '../../models/index.js';
import type { RequestScope } from '../../middleware/context.js';
import { aiConfigured, runToolLoop, runSingleToolCall, type ToolDefinition } from '../../lib/ai.js';
import { AI_TOOLS, callAiTool } from '../../services/aiTools.service.js';
import { badRequest, forbidden } from '../../lib/errors.js';

/**
 * AI assistant orchestration (§Phase 10, decision 7).
 *
 * Two distinct modes, deliberately kept apart:
 *  - `askAssistant`: a bounded, read-only tool-use conversation. Can look at
 *    the workspace's own data through the tool handlers; can never write.
 *  - `extractDraft`: a single forced tool call that turns free text or a
 *    receipt photo into a *draft* — never auto-saved. The caller still has
 *    to review and submit it through the ordinary Quick Add flow, exactly
 *    like a manually-typed entry.
 */

export async function getAiStatus(scope: RequestScope): Promise<AiStatusDto> {
  const user = await User.findById(scope.userId).select('preferences.aiAssistantEnabled').lean();
  return {
    configured: aiConfigured(),
    consentGiven: Boolean(user?.preferences?.aiAssistantEnabled),
  };
}

async function requireConsent(scope: RequestScope): Promise<void> {
  if (!aiConfigured()) {
    throw badRequest('The AI assistant is not configured on this server. Ask your administrator to set ANTHROPIC_API_KEY.');
  }
  const user = await User.findById(scope.userId).select('preferences.aiAssistantEnabled').lean();
  if (!user?.preferences?.aiAssistantEnabled) {
    throw forbidden('Turn on the AI assistant in Settings before using it. It is off by default and sends your financial data to an external model only once enabled.');
  }
}

const SYSTEM_PROMPT = [
  'You are the Khata assistant, answering questions about a user\'s own personal/household finances using read-only tools.',
  'Amounts from tools are in minor units (e.g. paise for INR, cents for USD) — always divide by 100 and format with the workspace currency before answering.',
  'Only answer using data returned by the tools. Never invent figures. If a tool returns nothing relevant, say so plainly.',
  'Keep answers short and concrete — a sentence or two, with the actual numbers, not a lecture.',
].join(' ');

export async function askAssistant(scope: RequestScope, question: string): Promise<{ answer: string }> {
  await requireConsent(scope);
  if (!question.trim()) throw badRequest('Ask a question first.');

  const { text } = await runToolLoop({
    system: SYSTEM_PROMPT,
    userMessage: question,
    tools: AI_TOOLS,
    callTool: (name, input) => callAiTool(scope, name, input),
  });

  return { answer: text || "I couldn't put together an answer for that." };
}

// ─────────────────────────────────────────────── Draft extraction

const DRAFT_TOOL: ToolDefinition = {
  name: 'extract_transaction_draft',
  description: 'Record the transaction details extracted from the user\'s text or receipt image.',
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['expense', 'income'], description: 'Whether money went out or came in.' },
      amount: { type: 'number', description: 'The amount in the major currency unit (rupees, not paise) — e.g. 450.50.' },
      description: { type: 'string', description: 'A short description, e.g. the merchant or reason.' },
      date: { type: 'string', description: 'ISO date (YYYY-MM-DD) if mentioned or visible; omit if unknown.' },
      categoryGuess: { type: 'string', description: 'A plausible category name for this, e.g. "Groceries", "Fuel", "Salary".' },
      accountGuess: { type: 'string', description: 'The account or payment method mentioned, e.g. "HDFC Bank", "cash" — omit if not mentioned.' },
    },
    required: ['type', 'amount', 'description'],
  },
};

interface RawDraft {
  type: 'expense' | 'income';
  amount: number;
  description: string;
  date?: string;
  categoryGuess?: string;
  accountGuess?: string;
}

/** Case/whitespace-insensitive best match: exact, then "starts with", then "contains". No fuzzy-distance scoring — good enough for short category/account names, and never silently picks a wrong one across a typo threshold. */
export function bestMatch<T extends { name: string }>(guess: string | undefined, candidates: T[]): T | null {
  if (!guess) return null;
  const needle = guess.trim().toLowerCase();
  if (!needle) return null;

  const exact = candidates.find((c) => c.name.toLowerCase() === needle);
  if (exact) return exact;

  const startsWith = candidates.find((c) => c.name.toLowerCase().startsWith(needle) || needle.startsWith(c.name.toLowerCase()));
  if (startsWith) return startsWith;

  const contains = candidates.find((c) => c.name.toLowerCase().includes(needle) || needle.includes(c.name.toLowerCase()));
  return contains ?? null;
}

async function resolveDraft(scope: RequestScope, raw: RawDraft): Promise<TransactionDraftDto> {
  // Fuzzy-match only ever runs against the CALLING USER's own workspace data —
  // never an id taken from model output directly, and never another user's data.
  const [categories, accounts] = await Promise.all([
    Category.find({ workspaceId: scope.workspaceId, kind: raw.type, isArchived: false }).select('name').lean(),
    Account.find({
      workspaceId: scope.workspaceId,
      deletedAt: null,
      isActive: true,
      $or: [{ visibility: 'shared' }, { visibility: { $exists: false } }, { visibility: 'private', userId: scope.userId }],
    })
      .select('name')
      .lean(),
  ]);

  const category = bestMatch(raw.categoryGuess, categories);
  const account = bestMatch(raw.accountGuess, accounts);
  const amountMinor = Math.round(Math.abs(raw.amount) * 100);

  return {
    type: raw.type,
    amountMinor,
    description: raw.description.slice(0, 200),
    date: raw.date && !Number.isNaN(Date.parse(raw.date)) ? new Date(raw.date).toISOString() : new Date().toISOString(),
    categoryId: category ? String(category._id) : null,
    categoryName: category?.name ?? raw.categoryGuess ?? null,
    accountId: account ? String(account._id) : null,
    accountName: account?.name ?? raw.accountGuess ?? null,
    matched: { category: Boolean(category), account: Boolean(account) },
  };
}

export async function extractDraftFromText(scope: RequestScope, text: string): Promise<TransactionDraftDto> {
  await requireConsent(scope);
  if (!text.trim()) throw badRequest('Describe the transaction first.');

  const raw = (await runSingleToolCall({
    system: 'Extract a single transaction from the user\'s short description. Guess sensibly but never fabricate an amount.',
    userMessage: text,
    tool: DRAFT_TOOL,
  })) as RawDraft;

  return resolveDraft(scope, raw);
}

export async function extractDraftFromReceipt(
  scope: RequestScope,
  image: { mediaType: string; base64: string },
): Promise<TransactionDraftDto> {
  await requireConsent(scope);

  const raw = (await runSingleToolCall({
    system: 'Extract a single transaction from this receipt photo: the total amount, merchant, date, and a plausible category. Never fabricate a total you cannot read.',
    userMessage: 'Here is the receipt.',
    tool: DRAFT_TOOL,
    images: [image],
  })) as RawDraft;

  return resolveDraft(scope, raw);
}
