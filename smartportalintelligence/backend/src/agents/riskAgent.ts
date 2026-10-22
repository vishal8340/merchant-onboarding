import { AgentResult, AgentType, AgentStatus, MerchantApplication } from '../types';
import { EventBus } from '../events/eventBus';
import { callDialWithUsage, parseDialJson, isDialNetworkError, countTokens } from '../services/dialService';
import { telemetry, estimateLlmCost } from '../services/telemetryService';
import axios from 'axios';

const SMART_RISK_URL = process.env.SMART_RISK_URL || 'http://localhost:8080';

export class RiskAgent {
  private highRiskCountries = ['XX', 'YY', 'ZZ'];

  constructor(private eventBus: EventBus) {}

  async startListening(): Promise<void> {
    await this.eventBus.consume(
      this.eventBus.QUEUE_RISK_ASSESSMENT,
      async (message) => {
        const application: MerchantApplication = message.application;
        console.log(`[Risk Agent] Received assessment request for ${application.id}`);
        
        const result = await this.assess(application);
        
        // Publish result back to event bus
        await this.eventBus.publish('result.risk', {
          applicationId: application.id,
          result
        });
      }
    );
  }

  async assess(application: MerchantApplication): Promise<AgentResult> {
    console.log(`[Risk Agent] Processing application ${application.id}`);

    const findings: string[] = [];
    let status = AgentStatus.PASSED;
    let score = 100;

    // Country risk
    if (this.highRiskCountries.includes(application.country)) {
      findings.push('Business located in high-risk jurisdiction');
      score -= 50;
      status = AgentStatus.MANUAL_REVIEW_REQUIRED;
    }

    // Business type risk
    const highRiskBusinessTypes = ['CRYPTO', 'GAMBLING', 'ADULT'];
    if (highRiskBusinessTypes.includes(application.businessType.toUpperCase())) {
      findings.push('High-risk business category');
      score -= 30;
      status = AgentStatus.MANUAL_REVIEW_REQUIRED;
    }

    if (!application.website) {
      score -= 10;
    }

    // Disposable email
    const emailDomain = application.contactEmail.split('@')[1];
    const disposableDomains = ['tempmail.com', 'disposable.com', 'guerrillamail.com'];
    if (disposableDomains.some(d => emailDomain?.includes(d))) {
      findings.push('Disposable email detected - potential fraud indicator');
      score -= 40;
      status = AgentStatus.FAILED;
    }

    // ── Textract: fraud-signal scan across all document text ─────────────────
    const textractResults: any[] = (application as any).textractResults || [];
    if (textractResults.length > 0) {
      const allText = textractResults.map((r: any) => r.text || '').join('\n').toLowerCase();

      const fraudKeywords = ['shell company', 'nominee', 'bearer share', 'money laundering', 'sanctioned', 'ofac'];
      const flaggedFraud = fraudKeywords.filter(kw => allText.includes(kw));
      if (flaggedFraud.length > 0) {
        findings.push(`🚨 Fraud-risk terms detected in documents: ${flaggedFraud.join(', ')}`);
        score -= 50;
        status = AgentStatus.FAILED;
      }

      // Positive signals — verified registration docs
      if (allText.includes('registered') || allText.includes('certificate of incorporation')) {
        findings.push('✅ Business registration evidence found in documents');
        score += 5;
      }
      if (allText.includes('tax clearance') || allText.includes('tax compliance')) {
        findings.push('✅ Tax compliance evidence found in documents');
        score += 5;
      }

      if (textractResults.length >= 2) {
        score += 5;
      }
    }

    // ── Smart Risk Scoring AI service ────────────────────────────────────────
    const smartRiskResult = await this.callSmartRiskScoring(application);
    if (smartRiskResult) {
      const compact = smartRiskResult.compactResult;
      const full = smartRiskResult.fullResult;

      findings.push(`✅ AI Risk Decision: ${compact.decision}`);
      findings.push(`✅ Risk Label: ${compact.riskLabel} (Score: ${compact.score})`);
      findings.push(`✅ Financial Exposure: $${compact.financialExposure?.toLocaleString()}/month`);

      // Country risk
      if (full.countryRisk) {
        const cr = full.countryRisk;
        findings.push(`✅ Country Risk: ${cr.location} — ${cr.riskLevel} (${cr.score}/100)`);
        if (cr.regulatoryNote) findings.push(`✅ Regulatory Note: ${cr.regulatoryNote}`);
      }

      // Fraud signals
      const fs = full.fraudSignals;
      if (fs) {
        if (fs.fraudDetected) {
          findings.push(`❌ Fraud Detected: ${fs.totalSignals} signal(s) — Severity: ${fs.severity}`);
          fs.indicators?.forEach((ind: string) => findings.push(`❌ Fraud Indicator: ${ind}`));
          status = AgentStatus.FAILED;
        } else {
          findings.push(`✅ Fraud Check: No fraud signals detected`);
        }
        // Show failed checks
        fs.checks?.filter((c: any) => c.status === 'FAIL').forEach((c: any) => {
          findings.push(`❌ Check Failed — ${c.check}: ${c.value}`);
        });
      }

      // Top LIME explanation factors
      if (full.explanation?.length > 0) {
        const top = full.explanation.slice(0, 3);
        top.forEach((e: any) => {
          // LIME explanations are informational — they show which features influenced
          // the model's output but do NOT override the model's decision or score.
          const isBenignValue = /^\s*(NONE|none|no|false|0[%\s.]|^0$)/i.test(e.displayValue ?? '');
          const isLowImpact = /^LOW$/i.test(e.impact ?? '');
          const isGenuineIncrease = e.direction?.includes('INCREASES') && !isBenignValue && !isLowImpact;
          const icon = isGenuineIncrease ? '⚠️' : '✅';
          findings.push(`${icon} ${e.feature}: ${e.displayValue} — ${e.direction} risk (${e.impact})`);
        });
        // NOTE: Status is NOT escalated here — LIME factors are informational.
      }

      // Override score with AI risk score (invert: low riskScore = high safety score)
      score = Math.max(0, 100 - (compact.riskScore ?? 0));

      // Update status based on AI decision
      // Service returns: DECLINED (High), CONDITIONAL (Medium), APPROVED (Low/default)
      if (compact.decision === 'DECLINED') {
        status = AgentStatus.FAILED;
      } else if (compact.decision === 'CONDITIONAL' && compact.score < 50) {
        // Only escalate to manual review for CONDITIONAL when score is genuinely borderline
        if (status === AgentStatus.PASSED) status = AgentStatus.MANUAL_REVIEW_REQUIRED;
      }
      // APPROVED or CONDITIONAL with score>=50 → keep current status (PASSED)
    } else {
      findings.push('⚠️ smart-risk-scoring service unavailable — using rule-based assessment only');
      score = Math.max(0, Math.min(100, score));
    }

    score = Math.max(0, Math.min(100, score));
    if (score < 40) status = AgentStatus.FAILED;
    else if (score < 60 && status === AgentStatus.PASSED) status = AgentStatus.MANUAL_REVIEW_REQUIRED;

    // ── Conditional LLM — only for HIGH risk or MANUAL_REVIEW ────────────────
    const riskScore = this.calculateRiskScore(application);
    let dialResponse: any;
    const needsLlm = status === AgentStatus.FAILED ||
                     status === AgentStatus.MANUAL_REVIEW_REQUIRED ||
                     score < 60;
    if (needsLlm) {
      console.log(`[Risk Agent] Calling DIAL — status=${status} score=${score} requires LLM review`);
      findings.push(`🤖 LLM risk reasoning triggered (${status})`);
      dialResponse = await this.callDialService(application, riskScore);
    } else {
      console.log(`[Risk Agent] DIAL skipped — ML score=${score} status=PASSED (low/medium risk)`);
      findings.push(`⚡ LLM skipped — Weka ML score ${score}/100 indicates low risk`);
      dialResponse = { status: 'skipped', reason: `ML score ${score} — low risk, no LLM needed`, provider: 'EPAM_AI_DIAL' };
    }

    console.log(`[Risk Agent] Result for ${application.id}: score=${score} status=${status}`);
    findings.forEach(f => console.log(`  ${f}`));

    return {
      agentType: AgentType.RISK,
      status,
      score,
      findings,
      requiresManualReview: status === AgentStatus.MANUAL_REVIEW_REQUIRED,
      completedAt: new Date(),
      dialResponse
    };
  }

  private async callSmartRiskScoring(application: MerchantApplication): Promise<any> {
    try {
      const textractResults: any[] = (application as any).textractResults || [];
      const allKV: Record<string, string> = {};
      textractResults.forEach((r: any) => Object.assign(allKV, r.keyValues || {}));
      const allText = textractResults.map((r: any) => r.text || '').join('\n').toLowerCase();

      // Extract location from KV pairs or fall back to country
      const locationKey = Object.keys(allKV).find(k => /location|address|city|state|country|region/i.test(k));
      const location = locationKey ? allKV[locationKey].split(',')[0].trim() : application.country;

      // Extract years in business from incorporation date if available
      let yearsInBusiness = 3;
      const dateKey = Object.keys(allKV).find(k =>
        /date|incorporated|incorporation|established|founded|registration[\s_-]?date|license[\s_-]?date|issue[\s_-]?date|valid[\s_-]?from|effective[\s_-]?date/i.test(k)
      );
      if (dateKey) {
        const yearMatch = allKV[dateKey].match(/\b(19|20)\d{2}\b/);
        if (yearMatch) yearsInBusiness = Math.max(1, new Date().getFullYear() - parseInt(yearMatch[0]));
      }
      // Also scan raw text for incorporation year if no KV matched
      if (!dateKey) {
        const textYearMatch = allText.match(/(?:incorporated|established|registered|founded)[^\d]*\b(19[89]\d|200\d|201[0-9]|202[0-4])\b/i);
        if (textYearMatch) yearsInBusiness = Math.max(1, new Date().getFullYear() - parseInt(textYearMatch[1]));
      }

      // Extract transaction volume from KV or derive from document count
      const volKey = Object.keys(allKV).find(k => /volume|revenue|turnover|sales|transaction/i.test(k));
      let transactionVolume = 50000;
      if (volKey) {
        const numMatch = allKV[volKey].replace(/,/g, '').match(/[\d]+/);
        if (numMatch) transactionVolume = parseInt(numMatch[0]);
      }

      // Extract chargeback rate
      // Priority 1: KV pair with chargeback/dispute/refund key
      const cbKey = Object.keys(allKV).find(k => /chargeback|dispute|refund/i.test(k));
      let chargebackRate = 0.002; // safe default: 0.2% (well below Visa VDMP 0.9%)
      if (cbKey) {
        const rawCb = allKV[cbKey];
        const numMatch = rawCb.match(/[\d.]+/);
        if (numMatch) {
          const val = parseFloat(numMatch[0]);
          chargebackRate = (rawCb.includes('%') || val > 1) ? val / 100 : val;
        }
      } else {
        // Priority 2: text regex fallback — scan raw document text for chargeback rate
        // Matches patterns like "Chargeback Rate: 0.20%" or "chargeback rate of 0.5%"
        const cbTextMatch = allText.match(
          /chargeback[\s\S]{0,30}?(\d+\.?\d*)\s*%/i
        );
        if (cbTextMatch) {
          chargebackRate = parseFloat(cbTextMatch[1]) / 100;
        }
      }
      console.log(`[Risk Agent] chargebackRate extracted: ${(chargebackRate * 100).toFixed(3)}% (from ${cbKey ? 'KV: ' + cbKey : cbKey === undefined && allText.match(/chargeback[\s\S]{0,30}?(\d+\.?\d*)\s*%/i) ? 'text regex' : 'default 0.2%'})`);


      // Extract average transaction size
      const avgKey = Object.keys(allKV).find(k => /average|avg|ticket|transaction size/i.test(k));
      let averageTransactionSize = 100;
      if (avgKey) {
        const numMatch = allKV[avgKey].replace(/,/g, '').match(/[\d]+/);
        if (numMatch) averageTransactionSize = parseInt(numMatch[0]);
      }

      // Extract compliance score from document KV pairs if explicitly stated
      let complianceScore: number | null = null;
      const compKey = Object.keys(allKV).find(k =>
        /compliance[\s_-]?score|compliance[\s_-]?rating|compliance[\s_-]?level|certification[\s_-]?score|aml[\s_-]?score/i.test(k)
      );
      if (compKey) {
        const numMatch = allKV[compKey].replace(/,/g, '').match(/[\d]+(\.\d+)?/);
        if (numMatch) {
          const val = parseFloat(numMatch[0]);
          // Handle both 0-100 and 0-10 scales
          complianceScore = val > 10 ? Math.min(100, val) : Math.min(100, val * 10);
        }
      }

      if (complianceScore === null) {
        // Derive compliance score from document completeness + positive compliance signals in text
        let baseScore = 50 + textractResults.length * 5 + (application.website ? 10 : 0);

        // Boost for strong compliance evidence in document text
        if (allText.includes('tax clearance') || allText.includes('tax compliance certificate')) baseScore += 10;
        if (allText.includes('certificate of incorporation') || allText.includes('duly registered')) baseScore += 8;
        if (allText.includes('good standing') || allText.includes('in good standing')) baseScore += 8;
        if (allText.includes('licensed') || allText.includes('business license')) baseScore += 5;
        if (allText.includes('aml compliant') || allText.includes('kyc compliant') || allText.includes('pci')) baseScore += 10;
        if (allText.includes('no criminal') || allText.includes('clear record') || allText.includes('no outstanding')) baseScore += 5;
        if (allText.includes('iso ') || allText.includes('iso/') || allText.includes('certified')) baseScore += 5;

        // Boost for compliance-related KV keys even without explicit score
        const hasComplianceKV = Object.keys(allKV).some(k =>
          /clearance|certified|license|permit|registration|accreditation/i.test(k)
        );
        if (hasComplianceKV) baseScore += 8;

        complianceScore = Math.min(100, baseScore);
      }

      console.log(`[Risk Agent] complianceScore derived: ${complianceScore} (from ${compKey ? 'KV: ' + compKey : 'document signals'})`);

      const requestBody = {
        businessType: application.businessType,
        transactionVolume,
        location,
        chargebackRate,
        yearsInBusiness,
        averageTransactionSize,
        complianceScore
      };

      console.log(`[Risk Agent] Calling smart-risk-scoring with:`, JSON.stringify(requestBody));
      const t1 = Date.now();
      // 60s timeout — the service makes 2 sequential LLM calls (~14s each at peak load)
      const response = await axios.post(`${SMART_RISK_URL}/api/risk/score`, requestBody, { timeout: 60000 });
      const latencyMs = Date.now() - t1;

      // Count tokens from the JSON payload we sent and the response we received.
      // smart-risk-scoring (Weka ML + internal LLM) doesn't expose token counts,
      // so we approximate from the serialised request + response.
      const riskReqTokens  = countTokens(JSON.stringify(requestBody));
      const riskRespTokens = countTokens(JSON.stringify(response.data));
      const riskLlmCost    = estimateLlmCost('gpt-4o', riskReqTokens, riskRespTokens);

      telemetry.record(application.id, {
        service: 'RISK_SCORING',
        model: 'weka-ml+llm',  // Weka ML + LLM internally
        agent: 'RISK',
        purpose: 'Risk score computation (Weka ML)',
        promptTokens: riskReqTokens,
        completionTokens: riskRespTokens,
        totalTokens: riskReqTokens + riskRespTokens,
        tokensEstimated: true,  // counted from serialised payload (no internal usage API)
        latencyMs,
        estimatedCostUsd: riskLlmCost,
        timestamp: new Date(),
      });

      return response.data;
    } catch (err: any) {
      console.error('[Risk Agent] smart-risk-scoring call failed:', err.message);
      telemetry.record(application.id, {
        service: 'RISK_SCORING',
        model: 'weka-ml+llm',
        agent: 'RISK',
        purpose: 'Risk score computation (Weka ML)',
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

  private async callDialService(application: MerchantApplication, riskScore: number): Promise<any> {
    const textractResults: any[] = (application as any).textractResults || [];
    const mergedKV: Record<string, string> = {};
    textractResults.forEach((r: any) => Object.assign(mergedKV, r.keyValues || {}));
    const kvContext = Object.entries(mergedKV).map(([k, v]) => `${k}: ${v}`).join('\n').slice(0, 2000);

    const messages = [
      {
        role: 'system' as const,
        content:
          'You are a financial crime and fraud risk assessment expert at a payment processor. ' +
          'Assess the risk of onboarding this merchant for payment processing. ' +
          'Return ONLY a valid JSON object with keys: riskScore (0-100 integer, higher = more risk), ' +
          'riskFactors (string array), recommendation (one of: APPROVE, REVIEW, REJECT), ' +
          'summary (one sentence).'
      },
      {
        role: 'user' as const,
        content:
          `Merchant Details:\n` +
          `Business Name: ${application.businessName}\n` +
          `Business Type: ${application.businessType}\n` +
          `Country: ${application.country}\n` +
          `Email: ${application.contactEmail}\n` +
          `Website: ${application.website || 'not provided'}\n` +
          `Tax ID: ${application.taxId}\n` +
          `Documents submitted: ${application.documents.length} document(s): ${application.documents.map((d: any) => d.type).join(', ')}\n\n` +
          `Rule-based risk score: ${riskScore}/100\n\n` +
          `Key-value pairs extracted from documents:\n${kvContext || '(no document data available)'}\n\n` +
          `Provide your independent risk assessment and return ONLY the JSON object, no markdown fences.`
      }
    ];

    const t0 = Date.now();
    try {
      console.log('[Risk Agent] Calling EPAM AI DIAL for risk assessment...');
      const dialResult = await callDialWithUsage(messages, 600);
      const latencyMs = Date.now() - t0;
      const parsed = parseDialJson<{
        riskScore: number;
        riskFactors: string[];
        recommendation: string;
        summary: string;
      }>(dialResult.content);

      telemetry.record(application.id, {
        service: 'DIAL',
        model: dialResult.model,
        agent: 'RISK',
        purpose: 'Risk assessment analysis',
        promptTokens: dialResult.promptTokens,
        completionTokens: dialResult.completionTokens,
        totalTokens: dialResult.totalTokens,
        tokensEstimated: dialResult.tokensEstimated,
        latencyMs,
        estimatedCostUsd: estimateLlmCost(dialResult.model, dialResult.promptTokens, dialResult.completionTokens),
        timestamp: new Date(),
      });

      console.log(`[Risk Agent] DIAL response — riskScore:${parsed.riskScore} recommendation:${parsed.recommendation}`);

      return {
        endpoint: `${process.env.DIAL_API_URL}/openai/deployments/${process.env.DIAL_MODEL}/chat/completions`,
        status: 'success',
        riskScore: parsed.riskScore,
        riskFactors: parsed.riskFactors,
        recommendation: parsed.recommendation,
        summary: parsed.summary,
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
        const recommendation = riskScore < 40 ? 'REJECT' : riskScore < 70 ? 'REVIEW' : 'APPROVE';
        telemetry.record(application.id, {
          service: 'DIAL',
          model: 'rule-based-offline',
          agent: 'RISK',
          purpose: 'Risk assessment analysis (offline — VPN required)',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          latencyMs,
          estimatedCostUsd: 0,
          timestamp: new Date(),
        });
        console.warn('[Risk Agent] DIAL unreachable (VPN required) — using rule-based fallback');
        return {
          endpoint: 'offline',
          status: 'offline',
          provider: 'RULE_BASED_FALLBACK',
          model: 'rule-based-offline',
          riskScore,
          riskFactors: ['country', 'businessType', 'documentation'],
          recommendation,
          summary: `Rule-based risk assessment: ${recommendation}. Connect to EPAM VPN for AI analysis.`,
          latencyMs,
          timestamp: new Date().toISOString(),
        };
      }

      telemetry.record(application.id, {
        service: 'DIAL',
        model: process.env.DIAL_MODEL ?? 'claude-3-5-sonnet',
        agent: 'RISK',
        purpose: 'Risk assessment analysis',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs,
        estimatedCostUsd: 0,
        error: err.message,
        timestamp: new Date(),
      });
      console.error('[Risk Agent] DIAL call failed:', err.message);
      return {
        endpoint: `${process.env.DIAL_API_URL}/openai/deployments/${process.env.DIAL_MODEL}/chat/completions`,
        status: 'error',
        riskScore,
        riskFactors: ['country', 'businessType', 'documentation'],
        recommendation: riskScore < 40 ? 'REJECT' : riskScore < 70 ? 'REVIEW' : 'APPROVE',
        error: err.message,
        provider: 'EPAM_AI_DIAL',
        latencyMs,
        timestamp: new Date().toISOString()
      };
    }
  }

  private calculateRiskScore(application: MerchantApplication): number {
    let riskScore = 50;
    
    if (application.website) riskScore += 10;
    if (application.documents.length >= 2) riskScore += 15;
    if (application.taxId.match(/^\d{2}-\d{7}$/)) riskScore += 10;
    
    return Math.min(riskScore, 100);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}