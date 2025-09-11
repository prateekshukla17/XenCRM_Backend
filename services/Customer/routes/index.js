const express = require('express');
const cors = require('cors');
const customerHandler = require('../controllers/customer');
const rabbitMQ = require('../../../shared/utils/rabbitmq');
const app = express();
require('dotenv').config();

app.use(express.json());
app.use(cors());

app.get('/health', (req, res) => {
  res.json({
    status: 'Healthy',
    service: 'custormer-service',
    timestamp: new Date().toISOString(),
  });
});
app.post('/customers', customerHandler.customer);

const PORT = process.env.PORT || 3001;

// Initialize RabbitMQ connection on startup
const initializeServices = async () => {
  try {
    console.log('Initializing RabbitMQ connection...');
    await rabbitMQ.connect();
    console.log('✅ RabbitMQ connection initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize RabbitMQ connection:', error);
    // Don't exit the process, let it retry later
  }
};

app.listen(PORT, async () => {
  console.log(`🚀 Customer service started on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  
  // Initialize services after server starts
  await initializeServices();
});
