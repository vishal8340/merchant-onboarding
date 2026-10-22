import { MerchantApplication, OnboardingStatus, AgentResult } from './types';
import { EventBus } from './events/eventBus';

export type DirectAgent = (application: MerchantApplication) => Promise<AgentResult>;

export class OnboardingOrchestrator {
  private pendingApplications: Map<string, {
    application: MerchantApplication;
    results: Map<string, AgentResult>;
    expectedResults: number;
    onComplete?: (app: MerchantApplication) => Promise<void>;
  }> = new Map();

  private directAgents: DirectAgent[] = [];

  constructor(private eventBus: EventBus) {}

  /** Register agent functions for direct (no-queue) invocation when RabbitMQ is unavailable. */
  registerDirectAgents(...agents: DirectAgent[]): void {
    this.directAgents = agents;
  }

  async initialize(): Promise<void> {
    // Listen for agent results
    await this.eventBus.consume(
      this.eventBus.QUEUE_AGENT_RESULTS,
      async (message) => {
        await this.handleAgentResult(message);
      }
    );

    console.log('[Orchestrator] Initialized and listening for agent results');
  }

  async processApplication(application: MerchantApplication, onComplete?: (app: MerchantApplication) => Promise<void>): Promise<void> {
    console.log(`[Orchestrator] Starting processing for ${application.id}`);

    application.status = OnboardingStatus.PROCESSING;
    this.addAuditLog(application, 'PROCESSING_STARTED', 'system', {
      applicationId: application.id,
      eventDriven: this.eventBus.isConnected()
    });

    // ── Direct (in-process) mode when RabbitMQ is unavailable ────────────────
    if (!this.eventBus.isConnected() && this.directAgents.length > 0) {
      console.log(`[Orchestrator] EventBus not connected — running ${this.directAgents.length} agents directly`);

      // Store pending so handleAgentResult can aggregate
      this.pendingApplications.set(application.id, {
        application,
        results: new Map(),
        expectedResults: this.directAgents.length,
        onComplete
      });

      // Run all agents in parallel; feed each result back through the normal pipeline
      await Promise.all(
        this.directAgents.map(agentFn =>
          agentFn(application)
            .then(result => this.handleAgentResult({ applicationId: application.id, result }))
            .catch(err => {
              console.error(`[Orchestrator] Direct agent error for ${application.id}:`, err);
            })
        )
      );
      return;
    }

    // ── Event-driven mode (RabbitMQ) ─────────────────────────────────────────

    // Track this application
    this.pendingApplications.set(application.id, {
      application,
      results: new Map(),
      expectedResults: 3, // KYC, MCC, Risk
      onComplete
    });

    // Publish events to trigger parallel agent processing
    await this.eventBus.publish('agent.kyc', { application });
    await this.eventBus.publish('agent.mcc', { application });
    await this.eventBus.publish('agent.risk', { application });

    console.log(`[Orchestrator] Published agent tasks for ${application.id}`);
  }

  private async handleAgentResult(message: any): Promise<void> {
    const { applicationId, result } = message;
    
    console.log(`[Orchestrator] Received ${result.agentType} result for ${applicationId}`);

    const pending = this.pendingApplications.get(applicationId);
    if (!pending) {
      console.warn(`[Orchestrator] No pending application found for ${applicationId}`);
      return;
    }

    // Store result
    pending.results.set(result.agentType, result);

    // Log individual agent completion
    this.addAuditLog(pending.application, `${result.agentType}_COMPLETED`, 'system', {
      status: result.status,
      score: result.score,
      findings: result.findings,
      dialResponse: result.dialResponse
    });

    // Check if all agents have completed
    if (pending.results.size === pending.expectedResults) {
      console.log(`[Orchestrator] All agents completed for ${applicationId}`);
      await this.aggregateResults(pending.application, Array.from(pending.results.values()));
    }
  }

  private async aggregateResults(
    application: MerchantApplication,
    results: AgentResult[]
  ): Promise<void> {
    console.log(`[Orchestrator] Aggregating results for ${application.id}`);

    application.agentResults = results;

    // Publish to aggregation service
    await this.eventBus.publish('aggregate', {
      applicationId: application.id,
      results
    });

    // Make final decision
    const decision = this.makeDecision(results);
    application.status = decision;

    this.addAuditLog(application, 'DECISION_MADE', 'system', {
      decision,
      finalStatus: application.status,
      aggregatedScores: results.map(r => ({ agent: r.agentType, score: r.score }))
    });

    console.log(`[Orchestrator] Application ${application.id} final status: ${application.status}`);

    // Persist final status via callback
    const pending = this.pendingApplications.get(application.id);
    if (pending?.onComplete) {
      try {
        await pending.onComplete(application);
      } catch (err) {
        console.error('[Orchestrator] Failed to persist final status:', err);
      }
    }

    // Clean up
    this.pendingApplications.delete(application.id);
  }

  private makeDecision(results: AgentResult[]): OnboardingStatus {
    // Auto-reject if any agent FAILED
    const hasFailure = results.some(r => r.status === 'FAILED');
    if (hasFailure) {
      return OnboardingStatus.REJECTED;
    }

    // Manual review if any agent explicitly requires it
    const requiresManualReview = results.some(r => r.requiresManualReview);
    if (requiresManualReview) {
      return OnboardingStatus.MANUAL_REVIEW;
    }

    // Score threshold: all agents must score >= 85 to auto-approve
    const allAboveThreshold = results.every(r => (r.score ?? 0) >= 85);
    if (allAboveThreshold) {
      return OnboardingStatus.APPROVED;
    }

    // Any agent below 85 → manual review
    return OnboardingStatus.MANUAL_REVIEW;
  }

  private addAuditLog(
    application: MerchantApplication,
    eventType: string,
    actor: string,
    details: Record<string, any>
  ): void {
    application.auditLog.push({
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      eventType,
      actor,
      details
    });
  }

  getApplication(applicationId: string): MerchantApplication | undefined {
    return this.pendingApplications.get(applicationId)?.application;
  }
}