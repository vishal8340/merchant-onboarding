package com.riskscoring.api;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Top-level API response wrapping both views:
 *
 *   compactResult → crisp summary for orchestrator (decision, score, flag, one-liner)
 *   fullResult    → complete pipeline output (fraud signals, LIME, LLM reports, etc.)
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RiskScoringResponse {
    private CompactResult compactResult;
    private RiskResponse fullResult;
}

