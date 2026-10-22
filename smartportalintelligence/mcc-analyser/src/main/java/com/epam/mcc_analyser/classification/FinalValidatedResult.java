package com.epam.mcc_analyser.classification;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public
class FinalValidatedResult {
    private String correlationId;
    private MccAnalysisReport aiAnalysis; // Includes citation & reasoning
    private String decisionStatus;       // APPROVED, FLAGGED_FOR_FRAUD, PENDING_REVIEW
    private long timestamp;
}
