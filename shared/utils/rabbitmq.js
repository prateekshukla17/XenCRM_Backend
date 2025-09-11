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

      await this.setupExchanges();

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
}
module.exports = new RabbitMQ();
