/**
 * TelemetryService — captures real AI usage per application.
 * Tracks token counts, latency, cost, and errors for every AI call made
 * during merchant onboarding processing.
 *
 * Cost rates (as of April 2026):
 *   - GPT-4o:                 $0.005/1k input,  $0.015/1k output
 *   - gpt-4o-mini:            $0.00015/1k input, $0.0006/1k output
 *   - claude-3-5-sonnet:      $0.003/1k input,  $0.015/1k output
 *   - text-embedding-3-small: $0.00002/1k tokens
 *   - AWS Textract AnalyzeDocument (FORMS): $0.065/100 pages = $0.00065/page
 *   - AWS Textract DetectDocumentText:      $0.0015/page
 */

export interface AICallRecord {
  service: 'DIAL' | 'AI_PROXY_GPT4O' | 'AI_PROXY_EMBEDDING' | 'TEXTRACT' | 'MCC_ANALYSER' | 'RISK_SCORING';
  model: string;
  agent: 'KYC' | 'MCC' | 'RISK' | 'TEXTRACT' | 'SYSTEM';
  purpose: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** true when token counts were estimated (API did not return usage data) */
  tokensEstimated?: boolean;
  latencyMs: number;
  estimatedCostUsd: number;
  pages?: number;            // Textract only
  confidence?: number;       // MCC analyser only
  error?: string;
  timestamp: Date;
}

export interface ApplicationTelemetry {
  applicationId: string;
  calls: AICallRecord[];
  totals: {
    totalCalls: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalLatencyMs: number;
    totalCostUsd: number;
    textractPages: number;
    textractCostUsd: number;
    llmCostUsd: number;
    errorCount: number;
  };
  collectedAt: Date;
}

// ── Cost rates per 1,000 tokens ─────────────────────────────────────────────
const COST_PER_1K: Record<string, { input: number; output: number }> = {
  'gpt-4o':                    { input: 0.005,    output: 0.015 },
  'gpt-4o-mini':               { input: 0.00015,  output: 0.0006 },
  'claude-3-5-sonnet':         { input: 0.003,    output: 0.015 },
  'claude-3-opus-20240229':    { input: 0.015,    output: 0.075 },
  'text-embedding-3-small':    { input: 0.00002,  output: 0 },
  'text-embedding-3-small-1':  { input: 0.00002,  output: 0 },
  'text-embedding-ada-002':    { input: 0.0001,   output: 0 },
};

const TEXTRACT_ANALYZE_PER_PAGE  = 0.00065;  // AnalyzeDocument (FORMS + TABLES)
const TEXTRACT_DETECT_PER_PAGE   = 0.0015;   // DetectDocumentText

export function estimateLlmCost(model: string, promptTokens: number, completionTokens: number): number {
  const rate = COST_PER_1K[model] ?? COST_PER_1K['gpt-4o'];
  return (promptTokens / 1000) * rate.input + (completionTokens / 1000) * rate.output;
}

export function estimateTextractCost(pages: number, mode: 'ANALYZE' | 'DETECT' = 'ANALYZE'): number {
  const ratePerPage = mode === 'ANALYZE' ? TEXTRACT_ANALYZE_PER_PAGE : TEXTRACT_DETECT_PER_PAGE;
  return pages * ratePerPage;
}

// ── In-memory store (written to MongoDB via server.ts) ──────────────────────
const telemetryStore = new Map<string, AICallRecord[]>();

export class TelemetryService {
  /** Record one AI call for an application */
  record(applicationId: string, call: AICallRecord): void {
    if (!telemetryStore.has(applicationId)) {
      telemetryStore.set(applicationId, []);
    }
    telemetryStore.get(applicationId)!.push(call);

    // Live log
    const costStr = `$${call.estimatedCostUsd.toFixed(5)}`;
    const tokenStr = call.totalTokens > 0 ? `${call.totalTokens} tokens` : `${call.pages ?? 0} pages`;
    console.log(
      `[Telemetry] ${call.agent}/${call.service} | ${call.model} | ${tokenStr} | ${call.latencyMs}ms | ${costStr} | ${call.purpose}`
    );
  }

  /** Get aggregated telemetry for one application */
  getForApplication(applicationId: string): ApplicationTelemetry {
    const calls = telemetryStore.get(applicationId) ?? [];
    const totals = calls.reduce(
      (acc, c) => {
        acc.totalCalls++;
        acc.totalTokens     += c.totalTokens;
        acc.promptTokens    += c.promptTokens;
        acc.completionTokens += c.completionTokens;
        acc.totalLatencyMs  += c.latencyMs;
        acc.totalCostUsd    += c.estimatedCostUsd;
        if (c.service === 'TEXTRACT') {
          acc.textractPages   += c.pages ?? 0;
          acc.textractCostUsd += c.estimatedCostUsd;
        } else {
          acc.llmCostUsd += c.estimatedCostUsd;
        }
        if (c.error) acc.errorCount++;
        return acc;
      },
      {
        totalCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
        totalLatencyMs: 0, totalCostUsd: 0, textractPages: 0,
        textractCostUsd: 0, llmCostUsd: 0, errorCount: 0
      }
    );
    return { applicationId, calls, totals, collectedAt: new Date() };
  }

  /** Get telemetry summaries for all tracked applications */
  getAllSummaries(): ApplicationTelemetry[] {
    return Array.from(telemetryStore.keys()).map(id => this.getForApplication(id));
  }

  /** Clear records for an application (after persisting to DB) */
  clear(applicationId: string): void {
    telemetryStore.delete(applicationId);
  }
}

// Singleton
export const telemetry = new TelemetryService();
