import axios from 'axios';
import { encode } from 'gpt-tokenizer';

const DIAL_API_URL = process.env.DIAL_API_URL || 'https://ai-proxy.lab.epam.com';
const DIAL_API_KEY = process.env.DIAL_API_KEY || '';
const DIAL_MODEL   = process.env.DIAL_MODEL   || 'gpt-4o';

export interface DialMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DialResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  /** true when token counts were estimated (API did not return usage) */
  tokensEstimated: boolean;
}

/**
 * Counts tokens using BPE tokenizer (cl100k_base — same as GPT-4/Claude).
 * Falls back to the 4-chars/token heuristic only if the tokenizer throws.
 */
export function countTokens(text: string): number {
  try { return encode(text).length; } catch { return Math.ceil(text.length / 4); }
}

/**
 * Counts prompt tokens for a message array.
 * Per OpenAI format: each message adds 4 tokens overhead (role/framing) + 2 reply primer.
 */
export function countPromptTokens(messages: DialMessage[]): number {
  return messages.reduce((sum, m) => sum + countTokens(m.content) + 4, 0) + 2;
}

/**
 * Calls the EPAM AI DIAL chat completions endpoint.
 * Endpoint: POST /openai/deployments/{model}/chat/completions
 * Auth header: Api-Key: <key>
 * Returns content + real token usage from the API response.
 */
export async function callDialWithUsage(messages: DialMessage[], maxTokens = 800): Promise<DialResult> {
  const url = `${DIAL_API_URL}/openai/deployments/${DIAL_MODEL}/chat/completions`;

  const response = await axios.post(
    url,
    { messages, max_tokens: maxTokens, temperature: 0 },
    {
      headers: { 'Api-Key': DIAL_API_KEY, 'Content-Type': 'application/json' },
      timeout: 30000,
    }
  );

  const data = response.data as any;
  const content: string = data?.choices?.[0]?.message?.content ?? '';
  const usage = data?.usage ?? {};

  let promptTokens:     number = usage.prompt_tokens     ?? 0;
  let completionTokens: number = usage.completion_tokens ?? 0;
  let totalTokens:      number = usage.total_tokens      ?? 0;
  let tokensEstimated = false;

  // EPAM DIAL proxy doesn't always return usage — fall back to BPE token counting
  if (totalTokens === 0) {
    promptTokens     = countPromptTokens(messages);
    completionTokens = countTokens(content);
    totalTokens      = promptTokens + completionTokens;
    tokensEstimated  = true;
  }

  return {
    content,
    promptTokens,
    completionTokens,
    totalTokens,
    model: data?.model ?? DIAL_MODEL,
    tokensEstimated,
  };
}

/**
 * Legacy wrapper — returns only the raw text (backwards compat).
 * Internally uses callDialWithUsage.
 */
export async function callDial(messages: DialMessage[], maxTokens = 800): Promise<string> {
  const result = await callDialWithUsage(messages, maxTokens);
  return result.content;
}

/**
 * Returns true when the error is a network connectivity failure reaching DIAL
 * (e.g. VPN not connected, hostname not resolvable).
 */
export function isDialNetworkError(err: any): boolean {
  const networkCodes = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENETUNREACH'];
  return networkCodes.includes(err?.code) ||
    (err?.request !== undefined && err?.response === undefined);
}

/**
 * Parses a JSON block from a DIAL response.
 * DIAL/Claude often wraps JSON in ```json ... ``` fences — this strips them.
 */
export function parseDialJson<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned) as T;
}
