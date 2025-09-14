const messageSendingService = require('./services/messageSendingService');
const responseProcessingConsumer = require('./consumers/responseProcessingConsumer');
const customerMVConsumer = require('./consumers/customer_mv_consumer');
const rabbitMQ = require('../../shared/utils/rabbitmq');

class MessagingOrchestrator {
  constructor() {
    this.services = {
      messageSending: messageSendingService,
      responseProcessing: responseProcessingConsumer,
      customerMV: customerMVConsumer
    };
    this.isRunning = false;
  }

  async start() {
    try {
      console.log('Starting Messaging Orchestrator...');
      
      // Ensure RabbitMQ connection first
      console.log('Establishing RabbitMQ connection...');
      await rabbitMQ.ensureConnection();
      
      if (!rabbitMQ.isConnectionActive()) {
        throw new Error('Failed to establish RabbitMQ connection');
      }
      
      console.log('RabbitMQ connection established successfully');
      
      // Start all services concurrently
      console.log('Starting all messaging services...');
      
      await Promise.all([
        this.services.messageSending.start(),
        this.services.responseProcessing.start(),
        this.services.customerMV.start()
      ]);
      
      this.isRunning = true;
      
      console.log('🚀 Messaging Orchestrator started successfully!');
      console.log('Services running:');
      console.log('  ✓ Message Sending Service - Polls DB and calls Mock API directly');
      console.log('  ✓ Response Processing Consumer - Updates communication logs from responses');
      console.log('  ✓ Customer MV Consumer - Handles customer data');
      
      // Display service statistics
      await this.displayStats();
      
    } catch (error) {
      console.error('Failed to start Messaging Orchestrator:', error);
      await this.stop();
      throw error;
    }
  }

  async stop() {
    try {
      console.log('Stopping Messaging Orchestrator...');
      
      // Stop all services
      await Promise.all([
        this.services.messageSending.stop(),
        this.services.responseProcessing.stop(),
        this.services.customerMV.stop()
      ]);
      
      // Close RabbitMQ connection
      await rabbitMQ.close();
      
      this.isRunning = false;
      console.log('Messaging Orchestrator stopped successfully');
      
    } catch (error) {
      console.error('Error stopping Messaging Orchestrator:', error);
      throw error;
    }
  }

  async displayStats() {
    try {
      console.log('\n📊 System Statistics:');
      console.log('====================');
      
      // Get RabbitMQ connection status
      console.log(`RabbitMQ Status: ${rabbitMQ.isConnectionActive() ? '✅ Connected' : '❌ Disconnected'}`);
      
      // Get recent response processing stats if available
      try {
        const stats = await this.services.responseProcessing.getProcessingStats();
        if (stats && !stats.error) {
          console.log('Last 24 Hours:');
          console.log(`  - Responses Processed: ${stats.last24Hours.receiptsProcessed}`);
          if (stats.last24Hours.statusBreakdown) {
            Object.entries(stats.last24Hours.statusBreakdown).forEach(([status, count]) => {
              console.log(`  - ${status}: ${count}`);
            });
          }
        }
      } catch (statsError) {
        console.log('Stats unavailable at startup');
      }
      
      console.log('\n🔄 Message Flow:');
      console.log('================');
      console.log('1. Communication logs with status PENDING');
      console.log('2. → Message Sending Service (polls DB)');
      console.log('3. → Mock Delivery API (90% success, 10% failure)');
      console.log('4. → Response Processing Queue (RabbitMQ)');
      console.log('5. → Response Processing Consumer (updates DB)');
      console.log('6. → Communication logs updated with final status');
      
    } catch (error) {
      console.error('Error displaying stats:', error);
    }
  }

  async getSystemHealth() {
    const health = {
      timestamp: new Date().toISOString(),
      orchestrator: {
        status: this.isRunning ? 'RUNNING' : 'STOPPED'
      },
      rabbitmq: {
        connected: rabbitMQ.isConnectionActive(),
        status: rabbitMQ.isConnectionActive() ? 'CONNECTED' : 'DISCONNECTED'
      },
      services: {}
    };

    // Check individual service health (basic implementation)
    Object.entries(this.services).forEach(([serviceName, service]) => {
      health.services[serviceName] = {
        status: 'RUNNING', // Services don't expose health endpoints, assume running
        type: serviceName.includes('Consumer') ? 'CONSUMER' : 'SERVICE'
      };
    });

    return health;
  }

  // Method to manually trigger message processing (for testing)
  async triggerMessageProcessing() {
    if (!this.isRunning) {
      throw new Error('Orchestrator not running');
    }

    console.log('Manually triggering message processing...');
    
    try {
      await this.services.messageSending.triggerProcessing();
      console.log('✅ Manual message processing triggered successfully');
    } catch (error) {
      console.error('❌ Failed to trigger message processing:', error);
      throw error;
    }
  }
}

// Create and export singleton instance
const messagingOrchestrator = new MessagingOrchestrator();

// Start the orchestrator if this file is run directly
if (require.main === module) {
  messagingOrchestrator.start().catch((error) => {
    console.error('Failed to start Messaging Orchestrator:', error);
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    try {
      await messagingOrchestrator.stop();
      console.log('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  };

  // Handle process signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGQUIT', () => shutdown('SIGQUIT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    shutdown('UNCAUGHT_EXCEPTION');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    shutdown('UNHANDLED_REJECTION');
  });
}

module.exports = messagingOrchestrator;