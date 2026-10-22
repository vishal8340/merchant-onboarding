/**
 * backfillTokens.ts
 *
 * One-shot migration: for every Application in MongoDB that has aiTelemetry
 * with calls where totalTokens === 0 (stored before gpt-tokenizer was added),
 * estimate tokens from the service type + typical prompt/response sizes and
 * persist updated totals back to the DB.
 *
 * Typical sizes (cl100k_base BPE):
 *   KYC DIAL call   — system ~120t, user ~250t, response ~180t  ≈ 550 total
 *   MCC DIAL call   — system ~100t, user ~200t, response ~80t   ≈ 380 total
 *   RISK DIAL call  — system ~130t, user ~300t, response ~200t  ≈ 630 total
 *   MCC_ANALYSER    — request ~40t,  response ~60t              ≈ 100 total
 *   RISK_SCORING    — request ~60t,  response ~150t             ≈ 210 total
 *   TEXTRACT        — token-based estimation irrelevant (page-based billing)
 *
 * Run: npx ts-node src/scripts/backfillTokens.ts
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { encode } from 'gpt-tokenizer';

// ── Cost rates (same as telemetryService) ────────────────────────────────────
const COST_PER_1K: Record<string, { input: number; output: number }> = {
  'gpt-4o':                 { input: 0.005,   output: 0.015 },
  'gpt-4o-mini':            { input: 0.00015, output: 0.0006 },
  'claude-3-5-sonnet':      { input: 0.003,   output: 0.015 },
  'claude-3-opus-20240229': { input: 0.015,   output: 0.075 },
  'weka-ml+llm':            { input: 0.005,   output: 0.015 }, // approximate, same as gpt-4o
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const rates = COST_PER_1K[model] ?? COST_PER_1K['gpt-4o'];
  return (promptTokens / 1000) * rates.input + (completionTokens / 1000) * rates.output;
}

/** Token estimates per service when no prompt content is stored */
const DEFAULT_TOKENS: Record<string, { prompt: number; completion: number }> = {
  'DIAL:KYC':          { prompt: 370, completion: 180 },
  'DIAL:MCC':          { prompt: 300, completion:  80 },
  'DIAL:RISK':         { prompt: 430, completion: 200 },
  'MCC_ANALYSER:MCC':  { prompt:  40, completion:  60 },
  'RISK_SCORING:RISK': { prompt:  60, completion: 150 },
};

function countTokens(text: string): number {
  try { return encode(text).length; } catch { return Math.ceil(text.length / 4); }
}

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/merchant-onboarding';
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  // Access the raw collection (avoid needing the full model import)
  const col = mongoose.connection.db!.collection('applications');
  const apps = await col.find({ 'aiTelemetry.calls': { $exists: true } }).toArray();

  console.log(`Found ${apps.length} applications with telemetry`);
  let updated = 0;

  for (const app of apps) {
    const tele = app.aiTelemetry as any;
    if (!tele || !Array.isArray(tele.calls)) continue;

    let changed = false;

    // Fix each call that has totalTokens === 0
    const updatedCalls = tele.calls.map((call: any) => {
      if ((call.totalTokens ?? 0) > 0) return call; // already has real data

      const key = `${call.service}:${call.agent}`;
      const defaults = DEFAULT_TOKENS[key] ?? { prompt: 200, completion: 100 };
      const prompt     = defaults.prompt;
      const completion = defaults.completion;
      const total      = prompt + completion;
      const cost       = estimateCost(call.model, prompt, completion);

      changed = true;
      return {
        ...call,
        promptTokens:     prompt,
        completionTokens: completion,
        totalTokens:      total,
        tokensEstimated:  true,
        estimatedCostUsd: call.estimatedCostUsd > 0 ? call.estimatedCostUsd : cost,
      };
    });

    if (!changed) continue;

    // Recompute totals
    const totals = updatedCalls.reduce(
      (acc: any, c: any) => {
        if (c.service === 'TEXTRACT') {
          acc.textractPages   += c.pages ?? 0;
          acc.textractCostUsd += c.estimatedCostUsd ?? 0;
        } else {
          acc.llmCostUsd += c.estimatedCostUsd ?? 0;
        }
        acc.totalCalls++;
        acc.totalTokens      += c.totalTokens      ?? 0;
        acc.promptTokens     += c.promptTokens     ?? 0;
        acc.completionTokens += c.completionTokens ?? 0;
        acc.totalLatencyMs   += c.latencyMs        ?? 0;
        acc.totalCostUsd     += c.estimatedCostUsd ?? 0;
        if (c.error) acc.errorCount++;
        return acc;
      },
      { totalCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
        totalLatencyMs: 0, totalCostUsd: 0, textractPages: 0,
        textractCostUsd: 0, llmCostUsd: 0, errorCount: 0 }
    );

    await col.updateOne(
      { _id: app._id },
      { $set: { 'aiTelemetry.calls': updatedCalls, 'aiTelemetry.totals': totals } }
    );

    console.log(`  ✅ ${app.businessName} — tokens: ${totals.totalTokens}  cost: $${totals.totalCostUsd.toFixed(4)}`);
    updated++;
  }

  console.log(`\n✅ Backfill complete — ${updated}/${apps.length} apps updated`);
  await mongoose.disconnect();
}

run().catch(err => { console.error('❌ Backfill failed:', err); process.exit(1); });
