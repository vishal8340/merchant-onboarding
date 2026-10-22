package com.epam.mcc_analyser.service;

import com.epam.mcc_analyser.classification.FinalValidatedResult;
import com.epam.mcc_analyser.classification.MccAnalysisReport;
import com.epam.mcc_analyser.classification.MccAuditor;
import com.epam.mcc_analyser.classification.MerchantTask;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

@Service
@Slf4j
public class SmartMccAnalyser {

    private final MccAuditor mccAuditor; // LangChain4j Service
    private final GuardrailService guardrailService; // Regex Logic
    private final RabbitTemplate rabbitTemplate;

    public SmartMccAnalyser(@Lazy MccAuditor mccAuditor,
                            GuardrailService guardrailService,
                            RabbitTemplate rabbitTemplate) {
        this.mccAuditor = mccAuditor;
        this.guardrailService = guardrailService;
        this.rabbitTemplate = rabbitTemplate;
    }

    //@RabbitListener(queues = "agent.mcc.queue")
    public FinalValidatedResult processAndAggregate(MerchantTask task) {
        log.info("🚀 Internal Aggregator: Processing {}", task.businessName());

        try {
            // 1. ANALYZE (AI Stage)
            MccAnalysisReport report = mccAuditor.analyze(
                    "Business: " + task.businessName() + " Desc: " + task.description()
            );

            // 2. AUDIT (Internal Aggregator/Guardrail Stage)
            String finalStatus = "APPROVED";
            String routingKey = "result.mcc.success";

            // If Regex finds a mismatch or AI confidence is low
            // Inside your processAndAggregate method:

            boolean needsEscalation = guardrailService.isEscalationRequired(
                    task.description(),
                    report.getMccCode()
            );

            if (needsEscalation) {
                log.error("🚨 SECURITY ALERT: AI returned SAFE MCC {} for description containing RISK keywords.",
                        report.getMccCode());
                // Trigger the Fraud Agent or set a Critical status
            }

            // 3. FINAL AGGREGATION: Wrap everything into one result
            FinalValidatedResult finalResult = new FinalValidatedResult(
                    task.correlationId(),
                    report,
                    finalStatus,
                    System.currentTimeMillis()
            );

            // 4. PUBLISH: Send the final verdict
            //.convertAndSend("onboarding.results.exchange", routingKey, finalResult);

            return finalResult;

        } catch (Exception e) {
            log.error("❌ Aggregator Failure: {}", e.getMessage());
        }
        return null;
    }
}