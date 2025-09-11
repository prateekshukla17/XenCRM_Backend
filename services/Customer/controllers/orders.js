const { customerDB } = require('../../../shared/database');
const rabbitMQ = require('../../../shared/utils/rabbitmq');
const Joi = require('joi');

// Define validation schema for order data
const orderSchema = Joi.object({
  customer_id: Joi.string().required().uuid().trim(),
  order_amount: Joi.number().required().precision(2).min(0.01),
  order_status: Joi.string().optional().valid('PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED').default('COMPLETED'),
});

const orders = async (req, res) => {
  try {
    // Ensure RabbitMQ connection is active
    await rabbitMQ.ensureConnection();
    
    // Check RabbitMQ connection
    if (!rabbitMQ.isConnectionActive()) {
      console.error('RabbitMQ connection is not active');
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable - messaging system down',
      });
    }

    // Validate request body
    const { error, value } = orderSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const validationErrors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
      });
    }

    // Verify customer exists before processing order
    try {
      const customerExists = await customerDB.prisma.customers.findUnique({
        where: { customer_id: value.customer_id },
        select: { customer_id: true, email: true, name: true },
      });

      if (!customerExists) {
        return res.status(404).json({
          success: false,
          message: 'Customer not found',
          error: 'The specified customer_id does not exist',
        });
      }
    } catch (dbError) {
      console.error('Database error while checking customer:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error while validating customer',
        error: process.env.NODE_ENV === 'development' ? dbError.message : undefined,
      });
    }

    // Prepare order event data
    const orderEventData = {
      eventType: 'order_data_received',
      timestamp: new Date().toISOString(),
      source: 'order_api',
      data: value,
    };

    // Publish message to RabbitMQ order queue
    const published = await rabbitMQ.publishMessage(
      'data_ingestion',
      'order',
      orderEventData
    );

    if (!published) {
      throw new Error('Failed to publish message to queue');
    }

    console.log('Order data published to queue:', {
      customer_id: value.customer_id,
      order_amount: value.order_amount,
      order_status: value.order_status,
      timestamp: orderEventData.timestamp,
    });

    // Send success response
    res.status(202).json({
      success: true,
      message: 'Order data received and queued for processing',
      data: {
        customer_id: value.customer_id,
        order_amount: value.order_amount,
        order_status: value.order_status,
        status: 'queued',
      },
    });
  } catch (error) {
    console.error('Error processing order data:', error);

    res.status(500).json({
      success: false,
      message: 'Internal server error while processing order data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

module.exports = {
  orders,
};
