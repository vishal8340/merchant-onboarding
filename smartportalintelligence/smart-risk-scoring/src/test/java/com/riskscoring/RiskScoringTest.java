package com.riskscoring;

import com.riskscoring.data.DataLoader;
import com.riskscoring.data.SyntheticDataGenerator;
import com.riskscoring.explain.LimeExplainer;
import com.riskscoring.model.RiskModelInference;
import com.riskscoring.model.RiskModelTrainer;
import org.junit.Test;
import weka.classifiers.trees.RandomForest;

import static org.junit.Assert.*;

/**
 * Unit tests for the risk scoring pipeline.
 */
public class RiskScoringTest {

    @Test
    public void testDataGeneration() throws Exception {
        SyntheticDataGenerator.generate(50, "data/test_merchants.csv");
        DataLoader.DataSet ds = DataLoader.load("data/test_merchants.csv");
        assertEquals(50, ds.features.length);
        assertEquals(50, ds.labels.length);
        assertEquals(10, ds.features[0].length);
    }

    @Test
    public void testRiskLabelAssignment() {
        assertEquals("High", SyntheticDataGenerator.assignRiskLabel(0.15, 0, 80, 50000));
        assertEquals("High", SyntheticDataGenerator.assignRiskLabel(0.05, 1, 80, 50000));
        assertEquals("Medium", SyntheticDataGenerator.assignRiskLabel(0.05, 0, 50, 50000));
        assertEquals("Medium", SyntheticDataGenerator.assignRiskLabel(0.05, 0, 80, 150000));
        assertEquals("Low", SyntheticDataGenerator.assignRiskLabel(0.05, 0, 80, 50000));
    }

    @Test
    public void testModelTrainingAndInference() throws Exception {
        SyntheticDataGenerator.generate(100, "data/test_merchants.csv");
        DataLoader.DataSet ds = DataLoader.load("data/test_merchants.csv");

        RandomForest model = RiskModelTrainer.train(ds.features, ds.labels);
        assertNotNull(model);

        RiskModelInference inference = new RiskModelInference(model);

        // High risk: fraud flag = 1, severity=CRITICAL(4), country_risk=80
        String result = inference.predict("Online", 180000, "Miami", 0.15, 1, 800, 1, 45, 4, 80);
        assertEquals("High", result);

        // Low risk merchant (severity=NONE(0), country_risk=25)
        String result2 = inference.predict("Retail", 30000, "NewYork", 0.01, 15, 40, 0, 95, 0, 25);
        assertEquals("Low", result2);
    }

    @Test
    public void testLimeExplanation() throws Exception {
        SyntheticDataGenerator.generate(100, "data/test_merchants.csv");
        DataLoader.DataSet ds = DataLoader.load("data/test_merchants.csv");
        RandomForest model = RiskModelTrainer.train(ds.features, ds.labels);
        RiskModelInference inference = new RiskModelInference(model);
        LimeExplainer explainer = new LimeExplainer(inference, 200);

        double[] features = DataLoader.encodeMerchant("Online", 180000, "Miami", 0.15, 1, 800, 1, 45, 4, 80);
        var explanation = explainer.explain(features);

        assertNotNull(explanation);
        assertFalse(explanation.isEmpty());
        assertEquals(10, explanation.size()); // one per feature
        System.out.println("Explanation: " + explanation);
    }

    @Test
    public void testModelPersistence() throws Exception {
        SyntheticDataGenerator.generate(100, "data/test_merchants.csv");
        DataLoader.DataSet ds = DataLoader.load("data/test_merchants.csv");
        RandomForest model = RiskModelTrainer.train(ds.features, ds.labels);

        RiskModelTrainer.saveModel(model, "data/test_model.ser");
        RandomForest loaded = RiskModelTrainer.loadModel("data/test_model.ser");
        assertNotNull(loaded);

        // Verify same predictions
        RiskModelInference inf1 = new RiskModelInference(model);
        RiskModelInference inf2 = new RiskModelInference(loaded);
        double[] features = DataLoader.encodeMerchant("Travel", 120000, "Dallas", 0.05, 5, 300, 0, 55, 1, 40);
        assertEquals(inf1.predictFromFeatures(features), inf2.predictFromFeatures(features));
    }
}

