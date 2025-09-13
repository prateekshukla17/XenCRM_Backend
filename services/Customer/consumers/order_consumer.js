const { customerDB } = require('../../../shared/database');
const rabbitMQ = require('../../../shared/utils/rabbitmq');

class OrderConsumer {
  constructor() {
    this.queueName = 'order_ingestion_queue';
  }

  async start() {
    try {
      console.log('Starting Order Consumer...');

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
        this.processOrderMessage.bind(this),
        {
          noAck: false,
          prefetch: 1,
        }
      );

      console.log(
        `Order Consumer started. Listening on queue: ${this.queueName}`
      );
    } catch (error) {
      console.error('Failed to start Order Consumer:', error);
      throw error;
    }
  }

  async processOrderMessage(messageContent, message) {
    try {
      // Validate message structure
      if (!messageContent.data || !messageContent.eventType) {
        throw new Error('Invalid message format: missing data or eventType');
      }

      const orderData = messageContent.data;

      // Validate required fields
      if (!orderData.customer_email || !orderData.order_amount) {
        throw new Error('Invalid order data: customer_email and order_amount are required');
      }

      // Process order data based on event type
      if (messageContent.eventType === 'order_data_received') {
        const result = await this.createOrder(orderData);
        console.log(`Order ${result.operation}: Order ID ${result.orderId} for Customer ${result.customerId} (${orderData.customer_email})`);
        
        // Update customer stats after successful order creation
        if (result.operation === 'created') {
          const updatedCustomerStats = await this.updateCustomerStats(result.customerId, orderData.order_amount);
          
          // Publish CustomerMV event with updated stats
          if (updatedCustomerStats) {
            await this.publishCustomerMVEvent(updatedCustomerStats);
          }
        }
      } else {
        console.warn(`Unknown event type: ${messageContent.eventType}`);
      }
    } catch (error) {
      console.error('Error processing order message:', error.message);
      throw error;
    }
  }

  async createOrder(orderData) {
    try {
      const {
        customer_email,
        order_amount,
        order_status = 'COMPLETED',
      } = orderData;

      // Find customer by email to get customer_id
      const customer = await customerDB.prisma.customers.findUnique({
        where: { email: customer_email.toLowerCase() },
        select: { customer_id: true, email: true, name: true },
      });

      if (!customer) {
        throw new Error(`Customer with email ${customer_email} does not exist`);
      }

      // Prepare data for database using the found customer_id
      const dbData = {
        customer_id: customer.customer_id,
        order_amount: parseFloat(order_amount),
        order_status: order_status.toUpperCase(),
        created_at: new Date(),
      };

      // Create new order
      const newOrder = await customerDB.prisma.orders.create({
        data: dbData,
      });

      return {
        operation: 'created',
        orderId: newOrder.order_id,
        customerId: newOrder.customer_id,
      };
    } catch (error) {
      console.error('Database error during order creation:', error);
      throw new Error(`Failed to create order: ${error.message}`);
    }
  }

  async updateCustomerStats(customerId, orderAmount) {
    try {
      // Get current customer data
      const customer = await customerDB.prisma.customers.findUnique({
        where: { customer_id: customerId },
        select: {
          customer_id: true,
          total_spend: true,
          total_visits: true,
        },
      });

      if (!customer) {
        console.warn(`Customer ${customerId} not found for stats update`);
        return;
      }

      // Calculate new totals
      const newTotalSpend = parseFloat(customer.total_spend || 0) + parseFloat(orderAmount);
      const newTotalVisits = (customer.total_visits || 0) + 1;

      // Update customer stats
      const updatedCustomer = await customerDB.prisma.customers.update({
        where: { customer_id: customerId },
        data: {
          total_spend: newTotalSpend,
          total_visits: newTotalVisits,
          last_order_at: new Date(),
          updated_at: new Date(),
        },
        select: {
          customer_id: true,
          name: true,
          email: true,
          total_spend: true,
          total_visits: true,
          last_order_at: true,
          status: true,
        },
      });

      console.log(`Updated customer ${customerId} stats: spend=${newTotalSpend}, visits=${newTotalVisits}`);
      return updatedCustomer;
    } catch (error) {
      console.error('Error updating customer stats:', error);
      // Don't throw here - we don't want to fail the order creation if stats update fails
      return null;
    }
  }

  async publishCustomerMVEvent(customerData) {
    try {
      // Get current total orders count for this customer
      const totalOrders = await customerDB.prisma.orders.count({
        where: { customer_id: customerData.customer_id }
      });

      const customerMVEventData = {
        eventType: 'customer_mv_upsert',
        timestamp: new Date().toISOString(),
        source: 'order_consumer',
        data: {
          customer_id: customerData.customer_id,
          name: customerData.name,
          email: customerData.email,
          total_spend: parseFloat(customerData.total_spend || 0),
          total_visits: customerData.total_visits || 0,
          total_orders: totalOrders,
          last_order_at: customerData.last_order_at,
          status: customerData.status,
          operation: 'stats_updated'
        },
      };

      const published = await rabbitMQ.publishMessage(
        'data_ingestion',
        'customer_mv',
        customerMVEventData
      );

      if (published) {
        console.log(`CustomerMV event published for customer: ${customerData.email} (stats updated) - Total Orders: ${totalOrders}, Spend: $${customerData.total_spend}`);
      } else {
        console.warn(`Failed to publish CustomerMV event for customer: ${customerData.email}`);
      }
    } catch (error) {
      console.error('Error publishing CustomerMV event:', error);
      // Don't throw - we don't want to fail order processing if MV event fails
    }
  }

  async stop() {
    console.log('Stopping Order Consumer...');
    // Note: RabbitMQ consumer will stop automatically when connection is closed
  }
}

// Create and export singleton instance
const orderConsumer = new OrderConsumer();

// Start the consumer if this file is run directly
if (require.main === module) {
  orderConsumer.start().catch((error) => {
    console.error('Failed to start order consumer:', error);
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    await orderConsumer.stop();
    await rabbitMQ.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = orderConsumer;