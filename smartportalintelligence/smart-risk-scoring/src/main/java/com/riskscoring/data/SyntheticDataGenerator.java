package com.riskscoring.data;

import java.io.FileWriter;
import java.io.IOException;
import java.util.Random;

/**
 * Generates realistic synthetic merchant data for risk scoring model training.
 *
 * Produces 1000 merchants across 5 business types and 5 locations with:
 * - Industry-specific transaction volumes, avg txn sizes, and chargeback rates
 * - Correlated fraud_flag ↔ fraud_severity ↔ chargeback_rate
 * - Location-correlated country_risk_score (Miami elevated, SanJose low)
 * - Realistic compliance scores (newer businesses tend to score lower)
 * - Edge cases: bust-out patterns, shell companies, high-value CNP, AML flags
 * - Balanced label distribution: ~40% Low, ~35% Medium, ~25% High
 */
public class SyntheticDataGenerator {

    private static final String[] BUSINESS_TYPES = {"Retail", "Restaurant", "Online", "Travel", "Subscription"};
    private static final String[] LOCATIONS = {"NewYork", "Chicago", "SanJose", "Miami", "Dallas"};
    private static final String OUTPUT_PATH = "data/merchants.csv";

    /**
     * Risk labeling rules:
     * - chargeback_rate > 0.1 OR fraud_flag == 1 OR fraud_severity >= 3 → High
     * - compliance_score < 60 OR country_risk_score > 70 → Medium
     * - transaction_volume > 100000 → Medium
     * - else → Low
     */
    public static String assignRiskLabel(double chargebackRate, int fraudFlag,
                                          double complianceScore, double transactionVolume,
                                          int fraudSeverity, double countryRiskScore) {
        if (chargebackRate > 0.1 || fraudFlag == 1 || fraudSeverity >= 3) return "High";
        if (complianceScore < 60 || countryRiskScore > 70) return "Medium";
        if (transactionVolume > 100000) return "Medium";
        return "Low";
    }

    // Backward-compatible overload for tests
    public static String assignRiskLabel(double chargebackRate, int fraudFlag,
                                          double complianceScore, double transactionVolume) {
        return assignRiskLabel(chargebackRate, fraudFlag, complianceScore, transactionVolume, 0, 50);
    }

    public static void generate(int numRecords, String outputPath) throws IOException {
        Random rand = new Random(42);
        new java.io.File(outputPath).getParentFile().mkdirs();

        try (FileWriter writer = new FileWriter(outputPath)) {
            writer.write("business_type,transaction_volume,location,chargeback_rate,years_in_business,"
                    + "average_transaction_size,fraud_flag,compliance_score,fraud_severity,country_risk_score,risk_label\n");

            for (int i = 0; i < numRecords; i++) {
                // --- Business type with weighted distribution ---
                // Online/Travel are overrepresented in payment risk datasets
                String businessType;
                double typeRoll = rand.nextDouble();
                if (typeRoll < 0.25) businessType = "Online";
                else if (typeRoll < 0.45) businessType = "Retail";
                else if (typeRoll < 0.60) businessType = "Restaurant";
                else if (typeRoll < 0.80) businessType = "Travel";
                else businessType = "Subscription";

                // --- Location with weighted distribution ---
                String location;
                double locRoll = rand.nextDouble();
                if (locRoll < 0.25) location = "NewYork";
                else if (locRoll < 0.45) location = "Miami";
                else if (locRoll < 0.60) location = "Chicago";
                else if (locRoll < 0.80) location = "SanJose";
                else location = "Dallas";

                // --- Years in business: skewed toward younger merchants ---
                int yearsInBusiness;
                double ageRoll = rand.nextDouble();
                if (ageRoll < 0.30) yearsInBusiness = 1 + rand.nextInt(3);      // 1-3 years (30%)
                else if (ageRoll < 0.60) yearsInBusiness = 4 + rand.nextInt(7);  // 4-10 years (30%)
                else if (ageRoll < 0.85) yearsInBusiness = 11 + rand.nextInt(10); // 11-20 years (25%)
                else yearsInBusiness = 21 + rand.nextInt(10);                     // 21-30 years (15%)

                // --- Transaction volume: industry-specific ---
                double transactionVolume = switch (businessType) {
                    case "Online" -> 20000 + rand.nextGaussian() * 40000 + rand.nextDouble() * 80000;
                    case "Travel" -> 30000 + rand.nextGaussian() * 30000 + rand.nextDouble() * 120000;
                    case "Subscription" -> 10000 + rand.nextGaussian() * 15000 + rand.nextDouble() * 50000;
                    case "Retail" -> 15000 + rand.nextGaussian() * 20000 + rand.nextDouble() * 60000;
                    case "Restaurant" -> 8000 + rand.nextGaussian() * 10000 + rand.nextDouble() * 40000;
                    default -> 10000 + rand.nextDouble() * 90000;
                };
                transactionVolume = Math.max(2000, Math.min(250000, transactionVolume));

                // --- Average transaction size: industry-specific ---
                double avgTxnSize = switch (businessType) {
                    case "Online" -> 30 + rand.nextGaussian() * 80 + rand.nextDouble() * 300;
                    case "Travel" -> 200 + rand.nextGaussian() * 150 + rand.nextDouble() * 600;
                    case "Subscription" -> 10 + rand.nextGaussian() * 20 + rand.nextDouble() * 80;
                    case "Retail" -> 20 + rand.nextGaussian() * 30 + rand.nextDouble() * 150;
                    case "Restaurant" -> 15 + rand.nextGaussian() * 15 + rand.nextDouble() * 60;
                    default -> 20 + rand.nextDouble() * 200;
                };
                avgTxnSize = Math.max(5, Math.min(1500, avgTxnSize));

                // --- Chargeback rate: industry-specific base + noise ---
                double baseChargebackRate = switch (businessType) {
                    case "Online" -> 0.008 + rand.nextGaussian() * 0.015;   // CNP = higher base
                    case "Travel" -> 0.010 + rand.nextGaussian() * 0.020;   // Disputes common
                    case "Subscription" -> 0.006 + rand.nextGaussian() * 0.012; // Involuntary churn
                    case "Retail" -> 0.003 + rand.nextGaussian() * 0.008;   // Card-present = lower
                    case "Restaurant" -> 0.002 + rand.nextGaussian() * 0.005; // Lowest risk
                    default -> 0.005 + rand.nextGaussian() * 0.010;
                };
                // Newer businesses have higher chargeback rates
                if (yearsInBusiness <= 2) baseChargebackRate += 0.01 + rand.nextDouble() * 0.03;
                double chargebackRate = Math.max(0.001, Math.min(0.25, baseChargebackRate));

                // --- Fraud flag: correlated with high chargebacks + new business ---
                int fraudFlag;
                if (chargebackRate > 0.08 && yearsInBusiness <= 3) {
                    fraudFlag = rand.nextDouble() < 0.60 ? 1 : 0;  // 60% chance
                } else if (chargebackRate > 0.05) {
                    fraudFlag = rand.nextDouble() < 0.25 ? 1 : 0;  // 25% chance
                } else {
                    fraudFlag = rand.nextDouble() < 0.05 ? 1 : 0;  // 5% baseline
                }

                // --- Compliance score: correlated with age + industry ---
                double baseCompliance = switch (businessType) {
                    case "Retail" -> 70 + rand.nextGaussian() * 12;
                    case "Restaurant" -> 68 + rand.nextGaussian() * 10;
                    case "Online" -> 55 + rand.nextGaussian() * 18;       // Wider variance
                    case "Travel" -> 60 + rand.nextGaussian() * 15;
                    case "Subscription" -> 62 + rand.nextGaussian() * 14;
                    default -> 60 + rand.nextGaussian() * 15;
                };
                // Newer businesses have lower compliance
                if (yearsInBusiness <= 2) baseCompliance -= 10 + rand.nextDouble() * 15;
                else if (yearsInBusiness >= 15) baseCompliance += 5 + rand.nextDouble() * 10;
                double complianceScore = Math.max(15, Math.min(100, baseCompliance));

                // --- Fraud severity: correlated with fraud_flag + chargebackRate ---
                int fraudSeverity;
                if (fraudFlag == 1 && chargebackRate > 0.10) {
                    fraudSeverity = 3 + rand.nextInt(2);                  // HIGH(3) or CRITICAL(4)
                } else if (fraudFlag == 1) {
                    fraudSeverity = 2 + rand.nextInt(2);                  // MODERATE(2) or HIGH(3)
                } else if (chargebackRate > 0.05) {
                    fraudSeverity = 1 + rand.nextInt(2);                  // LOW(1) or MODERATE(2)
                } else if (chargebackRate > 0.02 || complianceScore < 50) {
                    fraudSeverity = rand.nextDouble() < 0.3 ? 1 : 0;     // 30% LOW, 70% NONE
                } else {
                    fraudSeverity = 0;                                     // NONE
                }

                // --- Country risk score: correlated with location ---
                double countryRiskScore = switch (location) {
                    case "Miami" -> 55 + rand.nextGaussian() * 12 + rand.nextDouble() * 20;  // 55-87
                    case "NewYork" -> 35 + rand.nextGaussian() * 10 + rand.nextDouble() * 15; // 35-60
                    case "Chicago" -> 30 + rand.nextGaussian() * 8 + rand.nextDouble() * 18;  // 30-56
                    case "Dallas" -> 20 + rand.nextGaussian() * 8 + rand.nextDouble() * 15;   // 20-43
                    case "SanJose" -> 15 + rand.nextGaussian() * 6 + rand.nextDouble() * 15;  // 15-36
                    default -> 30 + rand.nextGaussian() * 10 + rand.nextDouble() * 20;
                };
                countryRiskScore = Math.max(5, Math.min(95, countryRiskScore));

                // === EDGE CASES (inject ~10% of records) ===
                if (i % 10 == 0) {
                    double edgeRoll = rand.nextDouble();
                    if (edgeRoll < 0.20) {
                        // Bust-out pattern: new business, high volume, moderate compliance
                        yearsInBusiness = 1;
                        transactionVolume = 120000 + rand.nextDouble() * 80000;
                        complianceScore = 40 + rand.nextDouble() * 20;
                        chargebackRate = 0.06 + rand.nextDouble() * 0.10;
                        fraudFlag = 1;
                        fraudSeverity = 3 + rand.nextInt(2);
                    } else if (edgeRoll < 0.40) {
                        // Shell company: brand new, very low compliance, low volume
                        yearsInBusiness = 1;
                        transactionVolume = 5000 + rand.nextDouble() * 15000;
                        complianceScore = 15 + rand.nextDouble() * 25;
                        avgTxnSize = 100 + rand.nextDouble() * 400;
                        chargebackRate = 0.02 + rand.nextDouble() * 0.05;
                        fraudFlag = rand.nextDouble() < 0.4 ? 1 : 0;
                        fraudSeverity = 2 + rand.nextInt(2);
                    } else if (edgeRoll < 0.60) {
                        // Perfect merchant: established, clean, low everything
                        yearsInBusiness = 15 + rand.nextInt(10);
                        transactionVolume = 20000 + rand.nextDouble() * 30000;
                        complianceScore = 90 + rand.nextDouble() * 10;
                        chargebackRate = 0.001 + rand.nextDouble() * 0.003;
                        fraudFlag = 0;
                        fraudSeverity = 0;
                        countryRiskScore = 10 + rand.nextDouble() * 20;
                    } else if (edgeRoll < 0.80) {
                        // AML Red Flag: high volume, low compliance
                        transactionVolume = 150000 + rand.nextDouble() * 100000;
                        complianceScore = 20 + rand.nextDouble() * 20;
                        chargebackRate = 0.01 + rand.nextDouble() * 0.03;
                        fraudSeverity = 2 + rand.nextInt(2);
                        countryRiskScore = 60 + rand.nextDouble() * 30;
                    } else {
                        // High-value CNP: online, very high avg txn
                        businessType = "Online";
                        avgTxnSize = 800 + rand.nextDouble() * 700;
                        transactionVolume = 80000 + rand.nextDouble() * 120000;
                        chargebackRate = 0.03 + rand.nextDouble() * 0.08;
                    }
                }

                String riskLabel = assignRiskLabel(chargebackRate, fraudFlag,
                        complianceScore, transactionVolume, fraudSeverity, countryRiskScore);

                writer.write(String.format("%s,%.2f,%s,%.4f,%d,%.2f,%d,%.2f,%d,%.2f,%s\n",
                        businessType, transactionVolume, location, chargebackRate,
                        yearsInBusiness, avgTxnSize, fraudFlag, complianceScore,
                        fraudSeverity, countryRiskScore, riskLabel));
            }
        }
        System.out.println("Generated " + numRecords + " merchant records at: " + outputPath);
    }

    public static void main(String[] args) throws IOException {
        generate(1000, OUTPUT_PATH);
    }
}

