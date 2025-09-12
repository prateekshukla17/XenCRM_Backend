const { campaignDB } = require('../../../shared/database');
const rabbitMQ = require('../../../shared/utils/rabbitmq');

class CustomerMVConsumer {
  constructor() {
    this.queueName = 'customer_mv_queue';
  }

  async start() {
    try {
      console.log('Starting CustomerMV Consumer...');

      // Ensure RabbitMQ connection
      console.log('Connecting to RabbitMQ...');
      await rabbitMQ.ensureConnection();

      if (!rabbitMQ.isConnectionActive()) {
        throw new Error('Failed to establish RabbitMQ connection');
      }

      console.log('RabbitMQ connection established');

      // Start consuming messages
      await rabbitMQ.consumeMessages(
        this.queueName,
        this.processCustomerMVMessage.bind(this),
        {
          noAck: false,
          prefetch: 1,
        }
      );

      console.log(
        `CustomerMV Consumer started. Listening on queue: ${this.queueName}`
      );
    } catch (error) {
      console.error('Failed to start CustomerMV Consumer:', error);
      throw error;
    }
  }

  async processCustomerMVMessage(messageContent, message) {
    try {
      // Validate message structure
      if (!messageContent.data || !messageContent.eventType) {
        throw new Error('Invalid message format: missing data or eventType');
      }

      const customerData = messageContent.data;

      // Validate required fields
      if (!customerData.email) {
        throw new Error('Invalid customer data: email is required');
      }

      // Process customer MV data based on event type
      if (messageContent.eventType === 'customer_mv_upsert') {
        const result = await this.upsertCustomerMV(customerData);
        console.log(`CustomerMV ${result.operation}: ${customerData.email} (ID: ${result.customerId})`);
      } else {
        console.warn(`Unknown event type: ${messageContent.eventType}`);
      }
    } catch (error) {
      console.error('Error processing CustomerMV message:', error.message);
      throw error;
    }
  }

  async upsertCustomerMV(customerData) {
    try {
      const {
        customer_id,
        name,
        email,
        total_spend = 0.0,
        total_visits = 0,
        last_order_at,
        status = 'ACTIVE',
        operation
      } = customerData;

      // Calculate days since last order
      const daysSinceLastOrder = last_order_at 
        ? Math.floor((new Date() - new Date(last_order_at)) / (1000 * 60 * 60 * 24))
        : null;

      // Prepare data for database
      const dbData = {
        name: name?.trim() || null,
        email: email.toLowerCase().trim(),
        total_spend: parseFloat(total_spend),
        total_visits: parseInt(total_visits) || 0,
        last_order_at: last_order_at ? new Date(last_order_at) : null,
        status: status.toUpperCase(),
        days_since_last_order: daysSinceLastOrder,
        synced_at: new Date(),
      };

      let result;

      if (customer_id) {
        // If customer_id is provided, try to upsert by customer_id
        const existingCustomer = await campaignDB.prisma.customers_mv.findUnique({
          where: { customer_id: customer_id },
        });

        if (existingCustomer) {
          // Update existing customer
          const updatedCustomer = await campaignDB.prisma.customers_mv.update({
            where: { customer_id: customer_id },
            data: dbData,
          });

          result = {
            operation: 'updated',
            customerId: updatedCustomer.customer_id,
          };
        } else {
          // Create new customer with provided customer_id
          const newCustomer = await campaignDB.prisma.customers_mv.create({
            data: {
              customer_id: customer_id,
              ...dbData,
            },
          });

          result = {
            operation: 'created',
            customerId: newCustomer.customer_id,
          };
        }
      } else {
        // If no customer_id, try to find by email (for cases where customer is created via API first)
        const existingCustomer = await campaignDB.prisma.customers_mv.findFirst({
          where: { email: dbData.email },
        });

        if (existingCustomer) {
          // Update existing customer found by email
          const updatedCustomer = await campaignDB.prisma.customers_mv.update({
            where: { customer_id: existingCustomer.customer_id },
            data: dbData,
          });

          result = {
            operation: 'updated',
            customerId: updatedCustomer.customer_id,
          };
        } else {
          // This case shouldn't happen in normal flow, but handle it gracefully
          console.warn(`Customer with email ${email} not found and no customer_id provided. Skipping.`);
          return {
            operation: 'skipped',
            customerId: null,
          };
        }
      }

      return result;
    } catch (error) {
      console.error('Database error during CustomerMV upsert:', error);
      throw new Error(`Failed to upsert CustomerMV: ${error.message}`);
    }
  }

  async stop() {
    console.log('Stopping CustomerMV Consumer...');
    // Note: RabbitMQ consumer will stop automatically when connection is closed
  }
}

// Create and export singleton instance
const customerMVConsumer = new CustomerMVConsumer();

// Start the consumer if this file is run directly
if (require.main === module) {
  customerMVConsumer.start().catch((error) => {
    console.error('Failed to start CustomerMV consumer:', error);
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    await customerMVConsumer.stop();
    await rabbitMQ.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = customerMVConsumer;