package com.riskscoring.messaging;

import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RabbitMQ configuration for merchant risk scoring.
 *
 * Queues:
 *   merchant.risk.request  — incoming merchant data to be scored
 *   merchant.risk.response — scored results ready for consumption
 *
 * Exchange: merchant.risk.exchange (topic)
 */
@Configuration
public class RabbitMQConfig {

    @Value("${rabbitmq.queue.request}")
    private String requestQueue;

    @Value("${rabbitmq.queue.response}")
    private String responseQueue;

    @Value("${rabbitmq.exchange}")
    private String exchange;

    @Value("${rabbitmq.routing.request}")
    private String requestRoutingKey;

    @Value("${rabbitmq.routing.response}")
    private String responseRoutingKey;

    @Bean
    public Queue requestQueue() {
        return QueueBuilder.durable(requestQueue).build();
    }

    @Bean
    public Queue responseQueue() {
        return QueueBuilder.durable(responseQueue).build();
    }

    @Bean
    public TopicExchange exchange() {
        return new TopicExchange(exchange);
    }

    @Bean
    public Binding requestBinding(Queue requestQueue, TopicExchange exchange) {
        return BindingBuilder.bind(requestQueue).to(exchange).with(requestRoutingKey);
    }

    @Bean
    public Binding responseBinding(Queue responseQueue, TopicExchange exchange) {
        return BindingBuilder.bind(responseQueue).to(exchange).with(responseRoutingKey);
    }

    @Bean
    public MessageConverter jsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(jsonMessageConverter());
        return template;
    }
}

