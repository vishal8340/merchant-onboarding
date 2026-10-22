package com.riskscoring.api;

import lombok.Data;

/**
 * Request DTO for merchant risk scoring API.
 * Note: fraudFlag, fraudSeverity, countryRiskScore are NOT user inputs —
 * they are auto-calculated from LLM fraud detection or rule-based fallback.
 */
@Data
public class MerchantRequest {
    private String businessType;
    private double transactionVolume;
    private String location;
    private double chargebackRate;
    private int yearsInBusiness;
    private double averageTransactionSize;
    private double complianceScore;

    // Derived internally — not from user input
    private int fraudFlag;
    private int fraudSeverity;          // LLM-derived: NONE=0, LOW=1, MODERATE=2, HIGH=3, CRITICAL=4
    private double countryRiskScore;    // LLM-derived: 0-100 geographic risk score
}
