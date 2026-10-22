package com.riskscoring.messaging;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.riskscoring.api.MerchantRequest;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * REST endpoint to publish merchant data to the RabbitMQ request queue.
 *
 * POST /api/risk/queue   — Publish merchant to queue for async processing
 * GET  /api/risk/queue/status — Check if RabbitMQ is connected
 *
 * Flow:
 *   1. Client POSTs merchant data to /api/risk/queue
 *   2. Data is published to merchant.risk.request queue
 *   3. RiskConsumer picks it up, runs the full pipeline
 *   4. Result is published to merchant.risk.response queue
 */
@RestController
@RequestMapping("/api/risk")
public class RiskProducer {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Value("${rabbitmq.exchange}")
    private String exchange;

    @Value("${rabbitmq.routing.request}")
    private String requestRoutingKey;

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Publish merchant data to the request queue for async risk scoring.
     */
    @PostMapping("/queue")
    public Map<String, Object> publishToQueue(@RequestBody MerchantRequest request) {
        String correlationId = UUID.randomUUID().toString();

        Map<String, Object> message = new LinkedHashMap<>();
        message.put("correlationId", correlationId);
        message.put("timestamp", System.currentTimeMillis());
        message.put("merchant", request);

        rabbitTemplate.convertAndSend(exchange, requestRoutingKey, message, msg -> {
            msg.getMessageProperties().setCorrelationId(correlationId);
            msg.getMessageProperties().setContentType("application/json");
            return msg;
        });

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("status", "QUEUED");
        response.put("correlationId", correlationId);
        response.put("message", "Merchant data published to risk scoring queue. Results will be available in merchant.risk.response queue.");
        response.put("requestQueue", "merchant.risk.request");
        response.put("responseQueue", "merchant.risk.response");
        return response;
    }

    /**
     * Check RabbitMQ connection status.
     */
    @GetMapping("/queue/status")
    public Map<String, Object> queueStatus() {
        Map<String, Object> status = new LinkedHashMap<>();
        try {
            rabbitTemplate.execute(channel -> {
                channel.queueDeclarePassive("merchant.risk.request");
                return null;
            });
            status.put("rabbitmq", "CONNECTED");
            status.put("requestQueue", "merchant.risk.request");
            status.put("responseQueue", "merchant.risk.response");
        } catch (Exception e) {
            status.put("rabbitmq", "DISCONNECTED");
            status.put("error", e.getMessage());
        }
        return status;
    }
}

