import amqp, { ChannelModel, Channel } from 'amqplib';

export class EventBus {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private readonly rabbitmqUrl: string;

  // Queue names
  public readonly QUEUE_APPLICATION_SUBMITTED = 'application.submitted';
  public readonly QUEUE_KYC_VERIFICATION = 'kyc.verification';
  public readonly QUEUE_MCC_CATEGORIZATION = 'mcc.categorization';
  public readonly QUEUE_RISK_ASSESSMENT = 'risk.assessment';
  public readonly QUEUE_AGENT_RESULTS = 'agent.results';
  public readonly QUEUE_AGGREGATION = 'aggregation.required';

  // Exchange
  private readonly EXCHANGE_NAME = 'merchant.onboarding';

  constructor(url: string = 'amqp://admin:admin123@localhost') {
    this.rabbitmqUrl = url;
  }

  async connect(): Promise<void> {
    try {
      console.log('[EventBus] Connecting to RabbitMQ...');
      const connection = await amqp.connect(this.rabbitmqUrl);
      const channel = await connection.createChannel();
      this.connection = connection;
      this.channel = channel;

      // Declare exchange
      await channel.assertExchange(this.EXCHANGE_NAME, 'topic', { durable: true });

      // Declare queues
      await channel.assertQueue(this.QUEUE_APPLICATION_SUBMITTED, { durable: true });
      await channel.assertQueue(this.QUEUE_KYC_VERIFICATION, { durable: true });
      await channel.assertQueue(this.QUEUE_MCC_CATEGORIZATION, { durable: true });
      await channel.assertQueue(this.QUEUE_RISK_ASSESSMENT, { durable: true });
      await channel.assertQueue(this.QUEUE_AGENT_RESULTS, { durable: true });
      await channel.assertQueue(this.QUEUE_AGGREGATION, { durable: true });

      // Bind queues to exchange with routing keys
      await channel.bindQueue(this.QUEUE_KYC_VERIFICATION, this.EXCHANGE_NAME, 'agent.kyc');
      await channel.bindQueue(this.QUEUE_MCC_CATEGORIZATION, this.EXCHANGE_NAME, 'agent.mcc');
      await channel.bindQueue(this.QUEUE_RISK_ASSESSMENT, this.EXCHANGE_NAME, 'agent.risk');
      await channel.bindQueue(this.QUEUE_AGENT_RESULTS, this.EXCHANGE_NAME, 'result.*');
      await channel.bindQueue(this.QUEUE_AGGREGATION, this.EXCHANGE_NAME, 'aggregate');

      console.log('[EventBus] Successfully connected to RabbitMQ');
    } catch (error) {
      console.error('[EventBus] Connection failed:', error);
      // For development without RabbitMQ, we'll continue
      console.log('[EventBus] Running in fallback mode without RabbitMQ');
    }
  }

  async publish(routingKey: string, message: any): Promise<void> {
    if (!this.channel) {
      console.log('[EventBus] No channel available, message not published:', routingKey);
      return;
    }

    try {
      const content = Buffer.from(JSON.stringify(message));
      this.channel.publish(
        this.EXCHANGE_NAME,
        routingKey,
        content,
        { persistent: true }
      );
      console.log(`[EventBus] Published message to ${routingKey}`);
    } catch (error) {
      console.error('[EventBus] Publish error:', error);
    }
  }

  async consume(
    queueName: string,
    callback: (message: any) => Promise<void>
  ): Promise<void> {
    if (!this.channel) {
      console.log('[EventBus] No channel available for consuming');
      return;
    }

    try {
      await this.channel.consume(queueName, async (msg) => {
        if (msg) {
          try {
            const content = JSON.parse(msg.content.toString());
            console.log(`[EventBus] Received message from ${queueName}`);
            await callback(content);
            this.channel?.ack(msg);
          } catch (error) {
            console.error('[EventBus] Message processing error:', error);
            this.channel?.nack(msg, false, true); // Requeue on error
          }
        }
      });
      console.log(`[EventBus] Listening on queue: ${queueName}`);
    } catch (error) {
      console.error('[EventBus] Consume error:', error);
    }
  }

  async close(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
      console.log('[EventBus] Connection closed');
    } catch (error) {
      console.error('[EventBus] Close error:', error);
    }
  }

  isConnected(): boolean {
    return this.channel !== null;
  }
}