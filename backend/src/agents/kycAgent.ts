import { AgentResult, AgentType, AgentStatus, MerchantApplication } from '../types';
import { EventBus } from '../events/eventBus';
import { callDialWithUsage, parseDialJson, isDialNetworkError } from '../services/dialService';
import { telemetry, estimateLlmCost } from '../services/telemetryService';

export class KYCAgent {
  constructor(private eventBus: EventBus) {}

  async startListening(): Promise<void> {
    await this.eventBus.consume(
      this.eventBus.QUEUE_KYC_VERIFICATION,
      async (message) => {
        const application: MerchantApplication = message.application;
        console.log(`[KYC Agent] Received verification request for ${application.id}`);
        
        const result = await this.verify(application);
        
        // Publish result back to event bus
        await this.eventBus.publish('result.kyc', {
          applicationId: application.id,
          result
        });
      }
    );
  }

  async verify(application: MerchantApplication): Promise<AgentResult> {
    console.log(`[KYC Agent] Processing application ${application.id}`);

    const findings: string[] = [];
    let status = AgentStatus.PASSED;
    let score = 100;

    // ── Textract-based document verification ─────────────────────────────────
    const textractResults: any[] = (application as any).textractResults || [];
    if (textractResults.length > 0) {
      findings.push(`Textract processed ${textractResults.length} document(s)`);

      // Merge all extracted key-values across documents
      const merged: Record<string, string> = {};
      textractResults.forEach((r: any) => Object.assign(merged, r.keyValues || {}));

      // Cross-validate business name
      if (merged.businessName) {
        const nameMatch = application.businessName.toLowerCase().includes(merged.businessName.toLowerCase()) ||
                          merged.businessName.toLowerCase().includes(application.businessName.toLowerCase());
        if (nameMatch) {
          findings.push(`✅ Business name verified via document: "${merged.businessName}"`);
          score += 10;
        } else {
          findings.push(`⚠️  Business name mismatch — Application: "${application.businessName}", Document: "${merged.businessName}"`);
          score -= 20;
          status = AgentStatus.MANUAL_REVIEW_REQUIRED;
        }
      }

      // Cross-validate Tax ID
      if (merged.taxId) {
        if (merged.taxId.replace(/\s/g, '') === application.taxId.replace(/\s/g, '')) {
          findings.push(`✅ Tax ID verified via document: ${merged.taxId}`);
          score += 10;
        } else {
          findings.push(`⚠️  Tax ID mismatch — Application: ${application.taxId}, Document: ${merged.taxId}`);
          score -= 30;
          status = AgentStatus.MANUAL_REVIEW_REQUIRED;
        }
      }

      if (merged.email) findings.push(`📧 Email extracted from document: ${merged.email}`);
      if (merged.phone) findings.push(`📞 Phone extracted from document: ${merged.phone}`);
      if (merged.address) findings.push(`📍 Address extracted: ${merged.address}`);
      if (merged.licenseNumber) findings.push(`🪪 License number: ${merged.licenseNumber}`);

      // Total words / lines extracted (data quality indicator)
      const totalWords = textractResults.reduce((s: number, r: any) => s + (r.wordCount || 0), 0);
      findings.push(`📄 Total words extracted by Textract: ${totalWords}`);
      if (totalWords < 10) {
        findings.push('⚠️  Very little text extracted — document may be low quality');
        score -= 15;
      }
    } else {
      findings.push('⚠️  No Textract data available — falling back to form-field validation');
    }

    // ── Standard field validation ─────────────────────────────────────────────
    if (application.businessName.length < 3) {
      findings.push('Business name too short');
      score -= 30;
    }

    if (!/^\d{2}-\d{7}$/.test(application.taxId)) {
      findings.push('Invalid Tax ID format (expected: XX-XXXXXXX)');
      score -= 40;
      status = AgentStatus.MANUAL_REVIEW_REQUIRED;
    }

    if (!application.contactEmail.includes('@')) {
      findings.push('Invalid email format');
      score -= 20;
    }

    // Document presence check
    const requiredDocs = ['BUSINESS_LICENSE', 'TAX_CERTIFICATE'];
    const uploadedDocTypes = application.documents.map(d => d.type);
    const missingDocs = requiredDocs.filter(doc => !uploadedDocTypes.includes(doc));
    if (missingDocs.length > 0) {
      findings.push(`Missing documents: ${missingDocs.join(', ')}`);
      score -= 50;
      status = AgentStatus.FAILED;
    }

    score = Math.max(0, Math.min(100, score));
    if (score < 50) status = AgentStatus.FAILED;
    else if (score < 85 && status === AgentStatus.PASSED) status = AgentStatus.MANUAL_REVIEW_REQUIRED;

    // ── Conditional LLM: only call DIAL for ambiguous / high-risk cases ──────
    let dialResponse: any = null;
    if (status !== AgentStatus.PASSED || score < 85) {
      findings.push('🤖 LLM analysis triggered (score or flags require review)');
      dialResponse = await this.callDialService(application);
    } else {
      findings.push('⚡ LLM skipped — all rule-based checks passed (score ≥ 85)');
      dialResponse = { status: 'skipped', reason: 'All rule-based checks passed', provider: 'EPAM_AI_DIAL' };
    }

    console.log(`[KYC Agent] Result for ${application.id}: score=${score} status=${status}`);
    findings.forEach(f => console.log(`  ${f}`));

    return {
      agentType: AgentType.KYC,
      status,
      score,
      findings,
      requiresManualReview: status === AgentStatus.MANUAL_REVIEW_REQUIRED,
      completedAt: new Date(),
      dialResponse
    };
  }

  private async callDialService(application: MerchantApplication): Promise<any> {
    const textractResults: any[] = (application as any).textractResults || [];
    const mergedKV: Record<string, string> = {};
    textractResults.forEach((r: any) => Object.assign(mergedKV, r.keyValues || {}));
    const kvContext = Object.entries(mergedKV).map(([k, v]) => `${k}: ${v}`).join('\n').slice(0, 800);

    const messages = [
      {
        role: 'system' as const,
        content:
          'KYC compliance analyst. Return ONLY JSON: {kycScore:0-100, flags:string[], recommendation:"PASS"|"REVIEW"|"FAIL", summary:string}'
      },
      {
        role: 'user' as const,
        content:
          `Merchant: ${application.businessName} | Tax: ${application.taxId} | Email: ${application.contactEmail} | Country: ${application.country} | Type: ${application.businessType} | Docs: ${application.documents.map((d: any) => d.type).join(',')}\n` +
          `Document KV: ${kvContext || '(none)'}\nReturn ONLY the JSON.`
      }
    ];

    const t0 = Date.now();
    try {
      console.log('[KYC Agent] Calling EPAM AI DIAL for KYC analysis...');
      const dialResult = await callDialWithUsage(messages, 600);
      const latencyMs = Date.now() - t0;
      const parsed = parseDialJson<{
        kycScore: number;
        flags: string[];
        recommendation: string;
        summary: string;
      }>(dialResult.content);

      // Record real telemetry
      telemetry.record(application.id, {
        service: 'DIAL',
        model: dialResult.model,
        agent: 'KYC',
        purpose: 'KYC compliance analysis',
        promptTokens: dialResult.promptTokens,
        completionTokens: dialResult.completionTokens,
        totalTokens: dialResult.totalTokens,
        tokensEstimated: dialResult.tokensEstimated,
        latencyMs,
        estimatedCostUsd: estimateLlmCost(dialResult.model, dialResult.promptTokens, dialResult.completionTokens),
        timestamp: new Date(),
      });

      console.log(`[KYC Agent] DIAL response — score:${parsed.kycScore} recommendation:${parsed.recommendation}`);

      return {
        endpoint: `${process.env.DIAL_API_URL}/openai/deployments/${process.env.DIAL_MODEL}/chat/completions`,
        status: 'success',
        verificationId: `kyc_${Date.now()}`,
        provider: 'EPAM_AI_DIAL',
        model: dialResult.model,
        kycScore: parsed.kycScore,
        flags: parsed.flags,
        recommendation: parsed.recommendation,
        summary: parsed.summary,
        promptTokens: dialResult.promptTokens,
        completionTokens: dialResult.completionTokens,
        latencyMs,
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      const latencyMs = Date.now() - t0;

      if (isDialNetworkError(err)) {
        // DIAL unreachable (VPN required) — rule-based offline fallback
        const hasValidTaxId = /^\d{2}-\d{7}$/.test(application.taxId);
        const hasValidEmail = application.contactEmail.includes('@');
        const hasRequiredDocs = ['BUSINESS_LICENSE', 'TAX_CERTIFICATE']
          .every(t => application.documents.some((d: any) => d.type === t));
        const kycScore = 60 + (hasValidTaxId ? 15 : 0) + (hasValidEmail ? 10 : 0) + (hasRequiredDocs ? 15 : 0);
        const recommendation = kycScore >= 85 ? 'PASS' : kycScore >= 60 ? 'REVIEW' : 'FAIL';
        const flags: string[] = [
          ...(!hasValidTaxId ? ['Invalid Tax ID format'] : []),
          ...(!hasValidEmail ? ['Invalid email'] : []),
          ...(!hasRequiredDocs ? ['Missing required documents'] : []),
        ];
        telemetry.record(application.id, {
          service: 'DIAL',
          model: 'rule-based-offline',
          agent: 'KYC',
          purpose: 'KYC compliance analysis (offline — VPN required)',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          latencyMs,
          estimatedCostUsd: 0,
          timestamp: new Date(),
        });
        console.warn('[KYC Agent] DIAL unreachable (VPN required) — using rule-based fallback');
        return {
          endpoint: 'offline',
          status: 'offline',
          provider: 'RULE_BASED_FALLBACK',
          model: 'rule-based-offline',
          kycScore,
          flags,
          recommendation,
          summary: `Rule-based KYC: ${recommendation}. Connect to EPAM VPN for AI analysis.`,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs,
          timestamp: new Date().toISOString(),
        };
      }

      telemetry.record(application.id, {
        service: 'DIAL',
        model: process.env.DIAL_MODEL ?? 'claude-3-5-sonnet',
        agent: 'KYC',
        purpose: 'KYC compliance analysis',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs,
        estimatedCostUsd: 0,
        error: err.message,
        timestamp: new Date(),
      });
      console.error('[KYC Agent] DIAL call failed:', err.message);
      return {
        endpoint: `${process.env.DIAL_API_URL}/openai/deployments/${process.env.DIAL_MODEL}/chat/completions`,
        status: 'error',
        error: err.message,
        provider: 'EPAM_AI_DIAL',
        latencyMs,
        timestamp: new Date().toISOString()
      };
    }
  }

}