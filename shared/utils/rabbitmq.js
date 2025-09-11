const ampq = require('amqplib');

class RabbitMQ {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      const rabbitmqURL = process.env.RabbitMQ_URL;
      console.log(`Connecting to RabbitMQ`);

      this.connection = await ampq.connect(rabbitmqURL);
      this.channel = await this.connection.createChannel();
      this.isConnected = true;

      await this.setupIngestion_Exchanges();

      console.log('Rabbit_MQ Connected');

      this.connection.on('error', (err) => {
        console.error('RabbitMQ connection error', err);
        this.connection = false;
      });

      this.connection.on('close', () => {
        console.log('Connection Closed');
        this.isConnected = false;
        setTimeout(() => this.connect(), 5000);
      });
    } catch (error) {
      console.error('Connection Failed to RabbitMQ', error);
      this.isConnected = false;

      setTimeout(() => this.connect(), 5000);
    }
  }

  async setupIngestion_Exchanges() {
    try {
      if (!this.channel) return;
      const ingestionExchange = 'data_ingestion';
      await this.channel.assertExchange(ingestionExchange, 'direct', {
        durable: true,
      });
      const customerQueue = 'customer_ingestion_queue';
      await this.channel.assertQueue(customerQueue, {
        durable: true,
        arguments: {
          'x-message-ttl': 86400000,
        },
      });

      await this.channel.bindQueue(
        customerQueue,
        ingestionExchange,
        'customer'
      );

      const ordersQueue = 'order_ingestion_queue';
      await this.channel.assertQueue(ordersQueue, {
        durable: true,
        arguments: {
          'x-message-ttl': 86400000,
        },
      });

      await this.channel.bindQueue(ordersQueue, ingestionExchange, 'order');

      console.log('Ingestion Infra setup complete');
      console.log('Exchange: Data_ingestions');
      console.log(
        '- Customer Queue: customer_ingestion_queue (routing key: customer)'
      );
      console.log(
        '- Orders Queue: orders_ingestion_queue (routing key: order)'
      );
    } catch (error) {
      console.error('Failed to setup Ingestion Infra:', error);
      throw error;
    }
  }

  async publishMessage(exchange, routingKey, message, options = {}) {
    if (!this.isConnected) throw new Error('RabbitMQ not connected');

    try {
      const messageBuffer = Buffer.from(JSON.stringify(message));
      const publishOptions = {
        persistent: true,
        timestamp: DATE.now(),
        messageId: `${Date.now()}-${Math.random()}`,
        ...options,
      };

      return this.channel.publish(
        exchange,
        routingKey,
        messageBuffer,
        publishOptions
      );
    } catch (error) {
      console.error('Failed to publish the message:', error);
    }
  }

  async consumeMessages(queue, callback, options = {}) {
    if (!this.isConnected) {
      throw new Error('RabbitMQ is not Connected');
    }
    try {
      const consumeOptions = {
        noAck: false,
        prefetch: 1,
        ...options,
      };

      await this.channel.prefetch(consumeOptions.prefetch);
      return this.channel.consume(
        queue,
        async (msg) => {
          if (msg) {
            try {
              const content = JSON.parse(msg.content.toString());
              await callback(content, msg);

              this.channel.ack(msg);
            } catch (error) {
              console.error('Error processing the message:', error);

              this.channel.nack(msg, false, false);
            }
          }
        },
        { noAck: consumeOptions.noAck }
      );
    } catch (error) {
      console.error('Failed to Consume messages:', error);
      throw error;
    }
  }
  async close() {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      this.isConnected = false;
      console.log('RabbitMQ connection closed successfully');
    } catch (error) {
      console.error('Error closing RabbitMQ connection:', error);
    }
  }

  getChannel() {
    return this.channel;
  }

  isConnectionActive() {
    return this.isConnected;
  }
}

module.exports = new RabbitMQ();
