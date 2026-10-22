import { AgentResult, AgentType, AgentStatus, MerchantApplication } from '../types';
import { EventBus } from '../events/eventBus';
import { callDialWithUsage, parseDialJson, isDialNetworkError, countTokens } from '../services/dialService';
import { telemetry, estimateLlmCost } from '../services/telemetryService';
import axios from 'axios';

const MCC_ANALYSER_URL = process.env.MCC_ANALYSER_URL || 'http://localhost:8091';

export class MCCAgent {
  private mccCodes: Record<string, string> = {
    'RETAIL': '5999',
    'ECOMMERCE': '5734',
    'SERVICES': '7299',
    'MANUFACTURING': '5085',
    'CRYPTO': '6051',
    'GAMBLING': '7995'
  };

  constructor(private eventBus: EventBus) {}

  async startListening(): Promise<void> {
    await this.eventBus.consume(
      this.eventBus.QUEUE_MCC_CATEGORIZATION,
      async (message) => {
        const application: MerchantApplication = message.application;
        console.log(`[MCC Agent] Received categorization request for ${application.id}`);
        
        const result = await this.categorize(application);
        
        // Publish result back to event bus
        await this.eventBus.publish('result.mcc', {
          applicationId: application.id,
          result
        });
      }
    );
  }

  async categorize(application: MerchantApplication): Promise<AgentResult> {
    console.log(`[MCC Agent] Processing application ${application.id}`);

    const findings: string[] = [];
    let status = AgentStatus.PASSED;
    let score = 100;

    const businessType = application.businessType.toUpperCase();
    const mccCode = this.mccCodes[businessType];

    if (!mccCode) {
      score -= 50;
      status = AgentStatus.MANUAL_REVIEW_REQUIRED;
    } else {
      if (['6051', '7995'].includes(mccCode)) {
        findings.push('High-risk MCC category detected');
        score -= 30;
        status = AgentStatus.MANUAL_REVIEW_REQUIRED;
      }
    }

    // ── Textract: scan all document text for category signals ────────────────
    const textractResults: any[] = (application as any).textractResults || [];
    if (textractResults.length > 0) {
      const allText = textractResults.map((r: any) => r.text || '').join('\n').toLowerCase();
      const allKeyValues: Record<string, string> = {};
      textractResults.forEach((r: any) => Object.assign(allKeyValues, r.keyValues || {}));

      // Look for high-risk keywords in document text
      const highRiskKeywords = ['gambling', 'casino', 'crypto', 'bitcoin', 'adult', 'firearms', 'tobacco', 'cannabis'];
      const flagged = highRiskKeywords.filter(kw => allText.includes(kw));
      if (flagged.length > 0) {
        findings.push(`🚨 High-risk keywords found in documents: ${flagged.join(', ')}`);
        score -= 40;
        status = AgentStatus.MANUAL_REVIEW_REQUIRED;
      }

      // Look for business category confirmations
      const categoryKeywords: Record<string, string[]> = {
        RETAIL: ['retail', 'store', 'shop', 'merchandise'],
        ECOMMERCE: ['e-commerce', 'ecommerce', 'online store', 'digital'],
        SERVICES: ['services', 'consulting', 'advisory', 'professional'],
        MANUFACTURING: ['manufacturing', 'production', 'factory', 'industrial']
      };
      const matchedCategories = Object.entries(categoryKeywords)
        .filter(([, kws]) => kws.some(kw => allText.includes(kw)))
        .map(([cat]) => cat);
      if (matchedCategories.length > 0) {
        findings.push(`✅ Category confirmed by document text: ${matchedCategories.join(', ')}`);
        score += 5;
      }

    }

    if (!application.website) {
      score -= 10;
    }

    // ── mcc-analyser AI service (LangChain4j + GPT-4o RAG) ──────────────────
    const mccAnalyserResult = await this.callMccAnalyserWithRetry(application);
    if (mccAnalyserResult) {
      const { mccCode: aiMccCode, confidence, reasoning, detectedRisks, handbookCitation } = mccAnalyserResult;

      const isFallback = confidence === 0 || reasoning?.toLowerCase().includes('unreachable') || reasoning?.toLowerCase().includes('fallback');

      if (isFallback) {
        findings.push(`⚠️ MCC Code (fallback, AI unreachable): ${aiMccCode}`);
        findings.push(`⚠️ Confidence Score: 0% — AI service did not respond after retries`);
        if (reasoning) findings.push(`⚠️ Reasoning: ${reasoning}`);
        // Don't override score from AI if it's a fallback — keep rule-based score
        if (status === AgentStatus.PASSED) status = AgentStatus.MANUAL_REVIEW_REQUIRED;
      } else {
        findings.push(`✅ MCC Code (AI-classified): ${aiMccCode}`);
        findings.push(`✅ Confidence Score: ${Math.round(confidence * 100)}%`);

        if (reasoning) {
          findings.push(`✅ Reasoning: ${reasoning}`);
        }
        if (handbookCitation) {
          findings.push(`✅ Handbook Reference: ${handbookCitation}`);
        }
        const realRisks = (detectedRisks || []).filter((r: string) => r && r.toLowerCase() !== 'none');
        if (realRisks.length > 0) {
          realRisks.forEach((risk: string) => {
            findings.push(`❌ Detected Risk: ${risk}`);
          });
          if (status === AgentStatus.PASSED) status = AgentStatus.MANUAL_REVIEW_REQUIRED;
        }

        // Composite score: AI confidence (primary) + clean-record bonus
        // +5 if no risks detected, so 80% confidence with a clean result reaches ≥ 85
        score = Math.round(confidence * 100);
        if (realRisks.length === 0) score = Math.min(100, score + 5);
      }
    } else {
      findings.push('⚠️ mcc-analyser service unavailable after retries — using rule-based classification only');
    }

    score = Math.max(0, Math.min(100, score));
    if (score < 65 && status === AgentStatus.PASSED) status = AgentStatus.MANUAL_REVIEW_REQUIRED;

    // ── Conditional LLM: only call DIAL if RAG confidence < 0.6 ─────────────
    const ragConfidence = mccAnalyserResult?.confidence ?? 0;
    let dialResponse: any;
    if (!mccAnalyserResult || ragConfidence < 0.6) {
      const reason = !mccAnalyserResult ? 'RAG unavailable' : `RAG confidence ${Math.round(ragConfidence * 100)}% < 60%`;
      console.log(`[MCC Agent] Calling DIAL — ${reason}`);
      findings.push(`🤖 DIAL fallback triggered (${reason})`);
      dialResponse = await this.callDialService(application, mccCode);
    } else {
      console.log(`[MCC Agent] DIAL skipped — RAG confidence ${Math.round(ragConfidence * 100)}% ≥ 60%`);
      findings.push(`⚡ DIAL skipped — RAG confidence ${Math.round(ragConfidence * 100)}% is sufficient`);
      dialResponse = { status: 'skipped', reason: `RAG confidence ${Math.round(ragConfidence * 100)}%`, provider: 'EPAM_AI_DIAL' };
    }

    console.log(`[MCC Agent] Result for ${application.id}: mcc=${mccCode} score=${score} status=${status}`);
    findings.forEach(f => console.log(`  ${f}`));

    return {
      agentType: AgentType.MCC,
      status,
      score,
      findings,
      requiresManualReview: status === AgentStatus.MANUAL_REVIEW_REQUIRED,
      completedAt: new Date(),
      dialResponse
    };
  }

  private async callDialService(application: MerchantApplication, mccCode?: string): Promise<any> {
    const textractResults: any[] = (application as any).textractResults || [];
    // Build KV context string for DIAL prompt
    const mergedKV: Record<string, string> = {};
    textractResults.forEach((r: any) => Object.assign(mergedKV, r.keyValues || {}));
    const kvContext = Object.entries(mergedKV).map(([k, v]) => `${k}: ${v}`).join('\n').slice(0, 2000);

    const messages = [
      {
        role: 'system' as const,
        content:
          'You are an MCC (Merchant Category Code) classification expert for a payment processor. ' +
          'Given the merchant details and any extracted document text, determine the correct 4-digit MCC code. ' +
          'Return ONLY a valid JSON object with keys: mccCode (4-digit string), category (string), ' +
          'riskLevel (one of: LOW, MEDIUM, HIGH), rationale (one sentence).'
      },
      {
        role: 'user' as const,
        content:
          `Merchant Details:\n` +
          `Business Name: ${application.businessName}\n` +
          `Business Type: ${application.businessType}\n` +
          `Website: ${application.website || 'not provided'}\n` +
          `Country: ${application.country}\n\n` +
          `Pre-assigned MCC (rule-based): ${mccCode || 'UNASSIGNED'}\n\n` +
          `Key-value pairs extracted from documents:\n${kvContext || '(no document data available)'}\n\n` +
          `Validate or correct the MCC code and return ONLY the JSON object, no markdown fences.`
      }
    ];

    const t0 = Date.now();
    try {
      console.log('[MCC Agent] Calling EPAM AI DIAL for MCC classification...');
      const dialResult = await callDialWithUsage(messages, 400);
      const latencyMs = Date.now() - t0;
      const parsed = parseDialJson<{
        mccCode: string;
        category: string;
        riskLevel: string;
        rationale: string;
      }>(dialResult.content);

      telemetry.record(application.id, {
        service: 'DIAL',
        model: dialResult.model,
        agent: 'MCC',
        purpose: 'MCC code validation',
        promptTokens: dialResult.promptTokens,
        completionTokens: dialResult.completionTokens,
        totalTokens: dialResult.totalTokens,
        tokensEstimated: dialResult.tokensEstimated,
        latencyMs,
        estimatedCostUsd: estimateLlmCost(dialResult.model, dialResult.promptTokens, dialResult.completionTokens),
        timestamp: new Date(),
      });

      console.log(`[MCC Agent] DIAL response — mcc:${parsed.mccCode} risk:${parsed.riskLevel}`);

      return {
        endpoint: `${process.env.DIAL_API_URL}/openai/deployments/${process.env.DIAL_MODEL}/chat/completions`,
        status: 'success',
        mccCode: parsed.mccCode,
        category: parsed.category,
        riskLevel: parsed.riskLevel,
        rationale: parsed.rationale,
        provider: 'EPAM_AI_DIAL',
        model: dialResult.model,
        promptTokens: dialResult.promptTokens,
        completionTokens: dialResult.completionTokens,
        latencyMs,
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      const latencyMs = Date.now() - t0;

      if (isDialNetworkError(err)) {
        // DIAL unreachable (VPN required) — rule-based offline fallback
        const resolvedMcc = mccCode || 'UNASSIGNED';
        const isHighRisk = ['6051', '7995'].includes(resolvedMcc);
        const riskLevel = isHighRisk ? 'HIGH' : resolvedMcc === 'UNASSIGNED' ? 'MEDIUM' : 'LOW';
        telemetry.record(application.id, {
          service: 'DIAL',
          model: 'rule-based-offline',
          agent: 'MCC',
          purpose: 'MCC code validation (offline — VPN required)',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          latencyMs,
          estimatedCostUsd: 0,
          timestamp: new Date(),
        });
        console.warn('[MCC Agent] DIAL unreachable (VPN required) — using rule-based fallback');
        return {
          endpoint: 'offline',
          status: 'offline',
          provider: 'RULE_BASED_FALLBACK',
          model: 'rule-based-offline',
          mccCode: resolvedMcc,
          category: application.businessType,
          riskLevel,
          rationale: `Rule-based MCC classification. Connect to EPAM VPN for AI validation.`,
          latencyMs,
          timestamp: new Date().toISOString(),
        };
      }

      telemetry.record(application.id, {
        service: 'DIAL',
        model: process.env.DIAL_MODEL ?? 'claude-3-5-sonnet',
        agent: 'MCC',
        purpose: 'MCC code validation',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs,
        estimatedCostUsd: 0,
        error: err.message,
        timestamp: new Date(),
      });
      console.error('[MCC Agent] DIAL call failed:', err.message);
      return {
        endpoint: `${process.env.DIAL_API_URL}/openai/deployments/${process.env.DIAL_MODEL}/chat/completions`,
        status: 'error',
        latencyMs,
        mccCode: mccCode || 'UNASSIGNED',
        riskLevel: ['6051', '7995'].includes(mccCode || '') ? 'HIGH' : 'MEDIUM',
        error: err.message,
        provider: 'EPAM_AI_DIAL',
        timestamp: new Date().toISOString()
      };
    }
  }

  private async callMccAnalyserWithRetry(
    application: MerchantApplication,
    maxAttempts = 3,
    baseDelayMs = 1000
  ): Promise<{
    mccCode: string;
    confidence: number;
    reasoning: string;
    detectedRisks: string[];
    handbookCitation: string;
  } | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`[MCC Agent] mcc-analyser attempt ${attempt}/${maxAttempts}...`);
      const result = await this.callMccAnalyser(application);

      // If we got a real (non-fallback) response, return it
      if (result && result.confidence > 0 && !result.reasoning?.toLowerCase().includes('unreachable')) {
        return result;
      }

      // Service returned a fallback response (confidence=0 or "unreachable" in reasoning)
      if (result) {
        console.warn(`[MCC Agent] mcc-analyser returned fallback response on attempt ${attempt} (confidence=${result.confidence}). Retrying...`);
      } else {
        console.warn(`[MCC Agent] mcc-analyser call failed on attempt ${attempt}. Retrying...`);
      }

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(`[MCC Agent] Waiting ${delay}ms before retry...`);
        await this.delay(delay);
      }
    }

    console.error(`[MCC Agent] mcc-analyser failed after ${maxAttempts} attempts — using rule-based fallback`);
    return null;
  }

  private async callMccAnalyser(application: MerchantApplication): Promise<{
    mccCode: string;
    confidence: number;
    reasoning: string;
    detectedRisks: string[];
    handbookCitation: string;
  } | null> {
    try {
      const textractResults: any[] = (application as any).textractResults || [];

      // ── Step 1: Start with UI form data as defaults ──────────────────────
      // Build location as "city, country" if city is provided, else just country
      const uiCity    = (application as any).city?.trim() || '';
      const uiCountry = application.country?.trim() || '';
      const uiLocation = uiCity && uiCountry
        ? `${uiCity}, ${uiCountry}`
        : uiCity || uiCountry;

      let businessName = application.businessName;   // from UI Step 1 "Business Name"
      let location     = uiLocation;                 // combined city + country from UI form
      let description  = application.businessType;   // from UI form "Business Type"

      const sources = {
        businessName: 'UI form (businessName)',
        location:     uiCity ? `UI form (city="${uiCity}", country="${uiCountry}")` : `UI form (country="${uiCountry}")`,
        description:  'UI form (businessType)'
      };

      // ── Step 2: Merge all Textract key-value pairs across documents ───────
      if (textractResults.length > 0) {
        const allKeyValues: Record<string, string> = {};
        textractResults.forEach((r: any) => Object.assign(allKeyValues, r.keyValues || {}, r.forms || {}));

        // businessName — look for company/business name in Textract KV
        const nameKey = Object.keys(allKeyValues).find(k =>
          /business.?name|company.?name|merchant.?name|entity.?name|corporation|inc\.|ltd\./i.test(k)
        );
        if (nameKey && allKeyValues[nameKey]?.trim()) {
          businessName = allKeyValues[nameKey].trim();
          sources.businessName = `Textract (key: "${nameKey}")`;
        }

        // location — look for address/city/country in Textract KV; prefer city-level, combine with country
        const cityKey = Object.keys(allKeyValues).find(k =>
          /\bcity\b|\btown\b|\bdistrict\b|\bmunicipality\b/i.test(k)
        );
        const locationKey = Object.keys(allKeyValues).find(k =>
          /location|address|state|country|region|registered.?office/i.test(k)
        );
        const textractCity    = cityKey    ? allKeyValues[cityKey]?.trim()    : '';
        const textractCountry = locationKey ? allKeyValues[locationKey]?.trim() : '';
        if (textractCity || textractCountry) {
          const combined = [textractCity, textractCountry].filter(Boolean).join(', ');
          location = combined || location;
          const usedKeys = [cityKey, locationKey].filter(Boolean).map(k => `"${k}"`).join(', ');
          sources.location = `Textract (keys: ${usedKeys})`;
        }

        // description — look for business activity/purpose/type in Textract KV
        const descKey = Object.keys(allKeyValues).find(k =>
          /description|nature|activity|business|purpose|product|service|industry/i.test(k)
        );
        if (descKey && allKeyValues[descKey]?.trim()) {
          description = allKeyValues[descKey].trim();
          sources.description = `Textract (key: "${descKey}")`;
        }
      }

      const payload = { businessName, location, description };

      console.log(`[MCC Agent] ── mcc-analyser payload sources ──`);
      console.log(`[MCC Agent]   businessName : "${businessName}" ← ${sources.businessName}`);
      console.log(`[MCC Agent]   location     : "${location}" ← ${sources.location}`);
      console.log(`[MCC Agent]   description  : "${description}" ← ${sources.description}`);
      console.log(`[MCC Agent] Calling mcc-analyser with:`, JSON.stringify(payload));

      const t1 = Date.now();
      const response = await axios.post(
        `${MCC_ANALYSER_URL}/api/v1/onboarding/classify`,
        payload,
        { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
      );
      const mccLatencyMs = Date.now() - t1;

      // Count tokens from the JSON payload we sent and the response we received
      // mcc-analyser (Java/LangChain4j) doesn't expose its internal token counts,
      // so we approximate using the serialised request + response strings.
      const reqTokens  = countTokens(JSON.stringify(payload));
      const respTokens = countTokens(JSON.stringify(response.data));
      const mccCost    = estimateLlmCost('gpt-4o', reqTokens, respTokens);

      telemetry.record(application.id, {
        service: 'MCC_ANALYSER',
        model: 'gpt-4o-2024-11-20',  // mcc-analyser uses GPT-4o (2024-11-20) via ai-proxy
        agent: 'MCC',
        purpose: 'MCC classification (LangChain4j RAG)',
        promptTokens: reqTokens,
        completionTokens: respTokens,
        totalTokens: reqTokens + respTokens,
        tokensEstimated: true,  // counted from serialised payload (no internal usage API)
        latencyMs: mccLatencyMs,
        estimatedCostUsd: mccCost,
        confidence: (response.data as any)?.confidence,
        timestamp: new Date(),
      });

      console.log(`[MCC Agent] mcc-analyser response:`, JSON.stringify(response.data));
      return response.data as { mccCode: string; confidence: number; reasoning: string; detectedRisks: string[]; handbookCitation: string; };
    } catch (err: any) {
      console.warn(`[MCC Agent] mcc-analyser service unavailable: ${err.message}`);
      telemetry.record(application.id, {
        service: 'MCC_ANALYSER',
        model: 'gpt-4o-2024-11-20',
        agent: 'MCC',
        purpose: 'MCC classification (LangChain4j RAG)',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: 0,
        estimatedCostUsd: 0,
        error: err.message,
        timestamp: new Date(),
      });
      return null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}