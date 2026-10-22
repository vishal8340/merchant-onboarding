package com.riskscoring.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Full pipeline result — nested under "fullResult" in the API response.
 * Contains all detailed data: fraud signals, LIME explanation, LLM reports, etc.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class RiskResponse {

    // ── Core decision ──
    private String decision;
    private String riskLabel;
    private double[] probabilities;
    private double financialExposure;
    private int riskScore;

    // ── Fraud detection ──
    private int fraudFlag;
    private List<String> fraudIndicators;
    private Map<String, Object> fraudSignals;

    // ── Country/location risk ──
    private Map<String, Object> countryRisk;

    // ── LIME explanation ──
    private List<Map<String, Object>> explanation;

    // ── LLM override & consistency ──
    private String overrideSuggestion;
    private String consistencyScore;

    // ── Verbose text reports ──
    private String summary;
    private String llmReport;
    private String complianceReport;
    private String salesReport;
    private String merchantNotification;
    private String executiveBrief;
    private String anomalyDescription;
}
