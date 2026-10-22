package com.riskscoring.model;

import com.riskscoring.data.DataLoader;
import weka.classifiers.trees.RandomForest;
import weka.core.Instance;
import weka.core.Instances;

/**
 * Loads a trained model and performs inference on new merchant data.
 * 
 * Sample usage:
 *   RiskModelInference inference = new RiskModelInference("data/risk_model.ser");
 *   String risk = inference.predict("Online", 150000, "Miami", 0.05, 2, 500, 0, 75);
 *   // Output: "Medium"
 */
public class RiskModelInference {

    private final RandomForest model;
    private final Instances header;

    public RiskModelInference(String modelPath) throws Exception {
        this.model = RiskModelTrainer.loadModel(modelPath);
        this.header = RiskModelTrainer.createHeader();
    }

    public RiskModelInference(RandomForest model) {
        this.model = model;
        this.header = RiskModelTrainer.createHeader();
    }

    /**
     * Predict risk label for a new merchant (10 features including LLM-derived).
     * @return "Low", "Medium", or "High"
     */
    public String predict(String businessType, double transactionVolume, String location,
                          double chargebackRate, int yearsInBusiness, double avgTxnSize,
                          int fraudFlag, double complianceScore,
                          int fraudSeverity, double countryRiskScore) throws Exception {
        double[] features = DataLoader.encodeMerchant(businessType, transactionVolume,
                location, chargebackRate, yearsInBusiness, avgTxnSize, fraudFlag, complianceScore,
                fraudSeverity, countryRiskScore);
        return predictFromFeatures(features);
    }

    /**
     * Predict from raw encoded feature vector.
     */
    public String predictFromFeatures(double[] features) throws Exception {
        Instance inst = RiskModelTrainer.buildSingleInstance(features, header);
        int prediction = (int) model.classifyInstance(inst);
        return DataLoader.RISK_LABELS[prediction];
    }

    /**
     * Get prediction probabilities for all classes.
     */
    public double[] predictProbabilities(double[] features) throws Exception {
        Instance inst = RiskModelTrainer.buildSingleInstance(features, header);
        return model.distributionForInstance(inst);
    }

    public static void main(String[] args) throws Exception {
        RiskModelInference inference = new RiskModelInference("data/risk_model.ser");

        System.out.println("=== Risk Model Inference Demo ===\n");

        // Sample 1: Low risk merchant (severity=NONE, country_risk=30)
        String result1 = inference.predict("Retail", 50000, "NewYork", 0.02, 10, 50, 0, 85, 0, 30);
        System.out.println("Merchant 1 (Retail, low chargeback, high compliance): " + result1);

        // Sample 2: High risk merchant (severity=CRITICAL, country_risk=80)
        String result2 = inference.predict("Online", 180000, "Miami", 0.15, 1, 800, 1, 45, 4, 80);
        System.out.println("Merchant 2 (Online, high chargeback, fraud flag): " + result2);

        // Sample 3: Medium risk merchant (severity=LOW, country_risk=40)
        String result3 = inference.predict("Travel", 120000, "Dallas", 0.05, 5, 300, 0, 55, 1, 40);
        System.out.println("Merchant 3 (Travel, high volume, low compliance): " + result3);
    }
}
