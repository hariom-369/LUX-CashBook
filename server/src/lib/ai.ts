import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * AI assistant provider adapter (§Phase 10, decision 7).
 *
 * Same shape as `mailer.ts`/`push.ts`: fully functional, but with no
 * `ANTHROPIC_API_KEY` configured the feature cleanly reports itself as
 * unavailable rather than faking a response. Unlike SMTP (which guards a
 * security-sensitive flow) there is nothing to refuse in production here —
 * the assistant is a convenience layered on top of already-complete
 * features, so "not configured" is a valid steady state anywhere.
 */
let client: Anthropic | null = null;

export function aiConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
}

export interface ToolCallResult {
  toolUseId: string;
  name: string;
  input: unknown;
  output: unknown;
}

/**
 * A bounded tool-use loop: the model may call read-only tools up to
 * `maxRounds` times before it must answer in plain text. Never lets the
 * model run unsupervised — this is a hard ceiling, not a retry budget.
 */
export async function runToolLoop(options: {
  system: string;
  userMessage: string;
  tools: ToolDefinition[];
  callTool: (name: string, input: unknown) => Promise<unknown>;
  maxRounds?: number;
}): Promise<{ text: string; toolCalls: ToolCallResult[] }> {
  const anthropic = getClient();
  const maxRounds = options.maxRounds ?? 4;
  const toolCalls: ToolCallResult[] = [];
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: options.userMessage }];

  for (let round = 0; round < maxRounds; round++) {
    const response = await anthropic.messages.create({
      model: env.AI_MODEL,
      max_tokens: 1024,
      system: options.system,
      tools: options.tools as Anthropic.Tool[],
      messages,
    });

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (toolUseBlocks.length === 0) {
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      return { text, toolCalls };
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      let output: unknown;
      try {
        output = await options.callTool(block.name, block.input);
      } catch (err) {
        output = { error: err instanceof Error ? err.message : 'Tool call failed.' };
      }
      toolCalls.push({ toolUseId: block.id, name: block.name, input: block.input, output });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(output),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  logger.warn({ rounds: maxRounds }, 'AI tool-use loop hit its round limit without a final answer');
  return { text: "I wasn't able to finish answering that — try asking something more specific.", toolCalls };
}

/** A single forced tool call — used for extraction (draft creation, receipt parsing), never a conversation. */
export async function runSingleToolCall(options: {
  system: string;
  userMessage: string;
  tool: ToolDefinition;
  images?: { mediaType: string; base64: string }[];
}): Promise<unknown> {
  const anthropic = getClient();
  const content: Anthropic.MessageParam['content'] = options.images?.length
    ? [
        ...options.images.map((img) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: img.mediaType as 'image/jpeg', data: img.base64 },
        })),
        { type: 'text' as const, text: options.userMessage },
      ]
    : options.userMessage;

  const response = await anthropic.messages.create({
    model: env.AI_MODEL,
    max_tokens: 1024,
    system: options.system,
    tools: [options.tool as Anthropic.Tool],
    tool_choice: { type: 'tool', name: options.tool.name },
    messages: [{ role: 'user', content }],
  });

  const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
  if (!toolUse) throw new Error('The assistant did not return structured data.');
  return toolUse.input;
}
