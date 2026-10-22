package com.riskscoring;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Spring Boot application for Smart Risk Scoring API.
 * 
 * Before starting the API, ensure the model is trained:
 *   mvn exec:java -Dexec.mainClass="com.riskscoring.model.RiskModelTrainer"
 * 
 * Then start the API:
 *   mvn spring-boot:run
 * 
 * Test endpoint:
 *   curl -X POST http://localhost:8080/api/risk/score \
 *     -H "Content-Type: application/json" \
 *     -d '{"businessType":"Online","transactionVolume":150000,"location":"Miami",
 *          "chargebackRate":0.12,"yearsInBusiness":2,"averageTransactionSize":500,
 *          "fraudFlag":1,"complianceScore":45}'
 */
@SpringBootApplication
public class RiskScoringApplication {
    public static void main(String[] args) {
        SpringApplication.run(RiskScoringApplication.class, args);
    }
}

