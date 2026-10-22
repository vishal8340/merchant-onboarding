package com.riskscoring.data;

import com.opencsv.CSVReader;
import com.opencsv.exceptions.CsvException;

import java.io.FileReader;
import java.io.IOException;
import java.util.*;

/**
 * Loads and preprocesses merchant CSV data for ML training.
 * Encodes categorical features as numeric values.
 */
public class DataLoader {

    // Encoding maps for categorical features
    public static final Map<String, Integer> BUSINESS_TYPE_MAP = Map.of(
            "Retail", 0, "Restaurant", 1, "Online", 2, "Travel", 3, "Subscription", 4);
    public static final Map<String, Integer> LOCATION_MAP = Map.of(
            "NewYork", 0, "Chicago", 1, "SanJose", 2, "Miami", 3, "Dallas", 4);
    public static final Map<String, Integer> RISK_LABEL_MAP = Map.of(
            "Low", 0, "Medium", 1, "High", 2);
    public static final String[] RISK_LABELS = {"Low", "Medium", "High"};
    public static final String[] FEATURE_NAMES = {
            "business_type", "transaction_volume", "location", "chargeback_rate",
            "years_in_business", "average_transaction_size", "fraud_flag", "compliance_score",
            "fraud_severity", "country_risk_score"
    };

    // LLM-derived fraud severity encoding: NONE=0, LOW=1, MODERATE=2, HIGH=3, CRITICAL=4
    public static final Map<String, Integer> FRAUD_SEVERITY_MAP = Map.of(
            "NONE", 0, "LOW", 1, "MODERATE", 2, "HIGH", 3, "CRITICAL", 4);

    public static int encodeFraudSeverity(String severity) {
        return FRAUD_SEVERITY_MAP.getOrDefault(severity != null ? severity.toUpperCase() : "NONE", 0);
    }

    /**
     * Loads CSV and returns features (double[][]) and labels (int[]).
     */
    public static DataSet load(String csvPath) throws IOException, CsvException {
        List<double[]> featuresList = new ArrayList<>();
        List<Integer> labelsList = new ArrayList<>();

        try (CSVReader reader = new CSVReader(new FileReader(csvPath))) {
            List<String[]> rows = reader.readAll();
            // Skip header
            for (int i = 1; i < rows.size(); i++) {
                String[] row = rows.get(i);
                if (row.length < 11) continue;

                double[] features = new double[10];
                features[0] = BUSINESS_TYPE_MAP.getOrDefault(row[0].trim(), 0);
                features[1] = Double.parseDouble(row[1].trim());
                features[2] = LOCATION_MAP.getOrDefault(row[2].trim(), 0);
                features[3] = Double.parseDouble(row[3].trim());
                features[4] = Double.parseDouble(row[4].trim());
                features[5] = Double.parseDouble(row[5].trim());
                features[6] = Double.parseDouble(row[6].trim());
                features[7] = Double.parseDouble(row[7].trim());
                features[8] = Double.parseDouble(row[8].trim());  // fraud_severity (0-4)
                features[9] = Double.parseDouble(row[9].trim());  // country_risk_score (0-100)

                int label = RISK_LABEL_MAP.getOrDefault(row[10].trim(), 0);

                featuresList.add(features);
                labelsList.add(label);
            }
        }

        double[][] features = featuresList.toArray(new double[0][]);
        int[] labels = labelsList.stream().mapToInt(Integer::intValue).toArray();

        System.out.println("Loaded " + features.length + " records with " + FEATURE_NAMES.length + " features.");
        return new DataSet(features, labels);
    }

    /**
     * Encode a single merchant record to feature vector (10 features).
     * Includes 2 LLM-derived features: fraud_severity and country_risk_score.
     */
    public static double[] encodeMerchant(String businessType, double transactionVolume,
                                           String location, double chargebackRate,
                                           int yearsInBusiness, double avgTxnSize,
                                           int fraudFlag, double complianceScore,
                                           int fraudSeverity, double countryRiskScore) {
        return new double[]{
                BUSINESS_TYPE_MAP.getOrDefault(businessType, 0),
                transactionVolume,
                LOCATION_MAP.getOrDefault(location, 0),
                chargebackRate,
                yearsInBusiness,
                avgTxnSize,
                fraudFlag,
                complianceScore,
                fraudSeverity,
                countryRiskScore
        };
    }

    /** Simple data holder for features and labels */
    public static class DataSet {
        public final double[][] features;
        public final int[] labels;

        public DataSet(double[][] features, int[] labels) {
            this.features = features;
            this.labels = labels;
        }
    }
}

