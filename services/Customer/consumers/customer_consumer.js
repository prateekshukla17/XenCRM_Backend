const { customerDB } = require('../../../shared/database');
const rabbitMQ = require('../../../shared/utils/rabbitmq');

class CustomerConsumer {
  constructor() {
    this.queueName = 'customer_ingestion_queue';
  }

  async start() {
    try {
      console.log('Starting Customer Consumer...');

      // Ensure RabbitMQ connection
      console.log('Connecting to RabbitMQ...');
      await rabbitMQ.ensureConnection();

      if (!rabbitMQ.isConnectionActive()) {
        throw new Error('Failed to establish RabbitMQ connection');
      }

      console.log('RabbitMQ connection established');

      await rabbitMQ.consumeMessages(
        this.queueName,
        this.processCustomerMessage.bind(this),
        {
          noAck: false,
          prefetch: 1,
        }
      );

      console.log(
        `Customer Consumer started. Listening on queue: ${this.queueName}`
      );
    } catch (error) {
      console.error('Failed to start Customer Consumer:', error);
      throw error;
    }
  }

  async processCustomerMessage(messageContent, message) {
    try {
      if (!messageContent.data || !messageContent.eventType) {
        throw new Error('Invalid message format: missing data or eventType');
      }

      const customerData = messageContent.data;

      // Validate required fields
      if (!customerData.name || !customerData.email) {
        throw new Error('Invalid customer data: name and email are required');
      }

      // Process customer data based on event type
      if (messageContent.eventType === 'customer_data_received') {
        const result = await this.upsertCustomer(customerData);
        console.log(`Customer ${result.operation}: ${customerData.email}`);
        
        // Publish CustomerMV event with actual customer_id after DB operation
        await this.publishCustomerMVEvent(result.customerId, customerData, result.operation);
      } else {
        console.warn(`Unknown event type: ${messageContent.eventType}`);
      }
    } catch (error) {
      console.error('Error processing customer message:', error.message);
      throw error;
    }
  }

  async upsertCustomer(customerData) {
    try {
      const {
        name,
        email,
        phone,
        total_spend = 0.0,
        total_visits = 0,
        last_order_at,
        status = 'ACTIVE',
      } = customerData;

      const dbData = {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        phone: phone ? phone.trim() : null,
        total_spend: parseFloat(total_spend),
        total_visits: parseInt(total_visits),
        last_order_at: last_order_at ? new Date(last_order_at) : null,
        status: status.toUpperCase(),
        updated_at: new Date(),
      };

      // Try to find existing customer by email
      const existingCustomer = await customerDB.prisma.customers.findUnique({
        where: { email: dbData.email },
      });

      if (existingCustomer) {
        const updatedCustomer = await customerDB.prisma.customers.update({
          where: { email: dbData.email },
          data: {
            name: dbData.name,
            phone: dbData.phone,
            total_spend: dbData.total_spend,
            total_visits: dbData.total_visits,
            last_order_at: dbData.last_order_at,
            status: dbData.status,
            updated_at: dbData.updated_at,
          },
        });

        return {
          operation: 'updated',
          customerId: updatedCustomer.customer_id,
        };
      } else {
        const newCustomer = await customerDB.prisma.customers.create({
          data: {
            ...dbData,
            created_at: new Date(),
          },
        });

        return {
          operation: 'created',
          customerId: newCustomer.customer_id,
        };
      }
    } catch (error) {
      console.error('Database error during customer upsert:', error);
      throw new Error(`Failed to upsert customer: ${error.message}`);
    }
  }

  async publishCustomerMVEvent(customerId, customerData, operation) {
    try {
      // Get total orders count for this customer
      const orderCount = await customerDB.prisma.orders.count({
        where: { customer_id: customerId }
      });

      const customerMVEventData = {
        eventType: 'customer_mv_upsert',
        timestamp: new Date().toISOString(),
        source: 'customer_consumer',
        data: {
          customer_id: customerId,
          name: customerData.name,
          email: customerData.email,
          total_spend: customerData.total_spend || 0.0,
          total_visits: customerData.total_visits || 0,
          total_orders: orderCount,
          last_order_at: customerData.last_order_at || null,
          status: customerData.status || 'ACTIVE',
          operation: operation // 'created' or 'updated'
        },
      };

      const published = await rabbitMQ.publishMessage(
        'data_ingestion',
        'customer_mv',
        customerMVEventData
      );

      if (published) {
        console.log(`CustomerMV event published for customer: ${customerData.email} (${operation})`);
      } else {
        console.warn(`Failed to publish CustomerMV event for customer: ${customerData.email}`);
      }
    } catch (error) {
      console.error('Error publishing CustomerMV event:', error);
      // Don't throw - we don't want to fail customer processing if MV event fails
    }
  }

  async stop() {
    console.log('Stopping Customer Consumer...');
    // Note: RabbitMQ consumer will stop automatically when connection is closed
  }
}

// Create and export singleton instance
const customerConsumer = new CustomerConsumer();

// Start the consumer if this file is run directly
if (require.main === module) {
  customerConsumer.start().catch((error) => {
    console.error('Failed to start customer consumer:', error);
    process.exit(1);
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    await customerConsumer.stop();
    await rabbitMQ.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = customerConsumer;
