package com.epam.mcc_analyser.exception;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.Map;
import java.util.concurrent.TimeoutException;

@ControllerAdvice
public class GlobalAiExceptionHandler {

    @ExceptionHandler(dev.langchain4j.exception.IllegalConfigurationException.class)
    public ResponseEntity<Map<String, Object>> handleTimeout(Exception e) {
        return ResponseEntity.status(HttpStatus.GATEWAY_TIMEOUT).body(Map.of(
                "error", "The AI classification took too long.",
                "suggestion", "Retry the request or route to manual queue.",
                "systemStatus", "PENDING_RETRY"
        ));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleParsingError(Exception e) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(Map.of(
                "error", "AI output was not in the expected format.",
                "details", e.getMessage(),
                "systemStatus", "ROUTED_TO_HUMAN"
        ));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneralError(Exception e) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                "error", "An unexpected system error occurred.",
                "message", e.getMessage()
        ));
    }
}