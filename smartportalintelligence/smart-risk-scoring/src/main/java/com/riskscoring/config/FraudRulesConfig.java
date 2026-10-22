package com.riskscoring.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configurable fraud detection thresholds.
 * All values loaded from application.properties (prefix: fraud.rules).
 * Change thresholds without recompiling — just edit properties and restart.
 */
@Data
@Component
@ConfigurationProperties(prefix = "fraud.rules")
public class FraudRulesConfig {

    private double chargebackThreshold = 0.05;
    private int bustOutMaxYears = 2;
    private double bustOutMinVolume = 100000;
    private double cnpMinAvgTransaction = 500;
    private String cnpBusinessType = "Online";
    private double amlMaxCompliance = 40;
    private double amlMinVolume = 80000;
    private int shellMaxYears = 1;
    private double shellMaxCompliance = 50;
    private double industryChargebackThreshold = 0.03;
    private String industryHighRiskTypes = "Travel,Subscription";

    /** Check if a business type is in the high-risk list */
    public boolean isHighRiskIndustry(String businessType) {
        for (String type : industryHighRiskTypes.split(",")) {
            if (type.trim().equalsIgnoreCase(businessType)) return true;
        }
        return false;
    }
}
