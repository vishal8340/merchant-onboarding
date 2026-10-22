package com.riskscoring;

import com.riskscoring.data.DataLoader;
import com.riskscoring.data.SyntheticDataGenerator;
import com.riskscoring.explain.LimeExplainer;
import com.riskscoring.model.RiskModelInference;
import com.riskscoring.model.RiskModelTrainer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import weka.classifiers.trees.RandomForest;

/**
 * Spring configuration to provide shared beans for model inference and explanation.
 */
@Configuration
public class AppConfig {

    @Bean
    public RiskModelInference riskModelInference() throws Exception {
        java.io.File modelFile = new java.io.File("data/risk_model.ser");
        if (!modelFile.exists()) {
            System.out.println("Model not found. Generating data and training model...");
            SyntheticDataGenerator.generate(1000, "data/merchants.csv");
            DataLoader.DataSet dataSet = DataLoader.load("data/merchants.csv");
            RandomForest model = RiskModelTrainer.train(dataSet.features, dataSet.labels);
            RiskModelTrainer.saveModel(model, "data/risk_model.ser");
        }
        return new RiskModelInference("data/risk_model.ser");
    }

    @Bean
    public LimeExplainer limeExplainer(RiskModelInference inference) {
        return new LimeExplainer(inference);
    }
}

