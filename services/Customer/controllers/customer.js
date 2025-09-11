const { customerDB } = require('../../../shared/database');
const rabbitMQ = require('../../../shared/utils/rabbitmq');
const Joi = require('joi');

// Define validation schema for customer data
const customerSchema = Joi.object({
  name: Joi.string().required().min(1).max(255).trim(),
  email: Joi.string().email().required().max(255).trim().lowercase(),
  phone: Joi.string().optional().max(20).trim(),
  total_spend: Joi.number().optional().precision(2).min(0).default(0),
  total_visits: Joi.number().integer().optional().min(0).default(0),
  last_order_at: Joi.date().optional(),
  status: Joi.string().optional().valid('ACTIVE', 'INACTIVE').default('ACTIVE'),
});

const customer = async (req, res) => {
  try {
    await rabbitMQ.ensureConnection();

    if (!rabbitMQ.isConnectionActive()) {
      console.error('RabbitMQ connection is not active');
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable - messaging system down',
      });
    }

    const { error, value } = customerSchema.validate(req.body, {
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

    const customerEventData = {
      eventType: 'customer_data_received',
      timestamp: new Date().toISOString(),
      source: 'customer_api',
      data: value,
    };

    const published = await rabbitMQ.publishMessage(
      'data_ingestion',
      'customer',
      customerEventData
    );

    if (!published) {
      throw new Error('Failed to publish message to queue');
    }

    console.log('Customer data published to queue:', {
      email: value.email,
      name: value.name,
      timestamp: customerEventData.timestamp,
    });

    // Send success response
    res.status(202).json({
      success: true,
      message: 'Customer data received and queued for processing',
      data: {
        email: value.email,
        name: value.name,
        status: 'queued',
      },
    });
  } catch (error) {
    console.error('Error processing customer data:', error);

    res.status(500).json({
      success: false,
      message: 'Internal server error while processing customer data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

module.exports = {
  customer,
};
