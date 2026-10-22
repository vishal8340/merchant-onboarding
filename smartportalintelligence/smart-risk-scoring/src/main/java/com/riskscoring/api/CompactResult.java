package com.riskscoring.api;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Compact result for orchestrator consumption.
 * Contains only the key decision fields + a one-line summary.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CompactResult {
    private String decision;           // APPROVED, CONDITIONAL, DECLINED
    private String riskLabel;          // Low, Medium, High
    private double financialExposure;  // volume × chargeback_rate
    private int riskScore;             // 0-100 (higher = more risky)
    private String score;              // 0-100 confidence (higher = safer), e.g. "97/100"
    private int fraudFlag;             // 0 or 1
    private int totalSignals;          // total fraud signals detected
    private String summary;            // one-line human-readable summary
}

