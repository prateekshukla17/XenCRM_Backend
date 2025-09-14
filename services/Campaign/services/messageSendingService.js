const { campaignDB } = require('../../../shared/database');
const rabbitMQ = require('../../../shared/utils/rabbitmq');
const mockReceiverService = require('./mockReceiverService');

class MessageSendingService {
  constructor() {
    this.batchSize = 10; // Number of messages to process in each batch
    this.pollingInterval = 5000; // 5 seconds
    this.isRunning = false;
  }

  async start() {
    try {
      console.log('Starting Message Sending Service...');
      
      // Ensure RabbitMQ connection
      await rabbitMQ.ensureConnection();
      
      if (!rabbitMQ.isConnectionActive()) {
        throw new Error('Failed to establish RabbitMQ connection');
      }
      
      console.log('RabbitMQ connection established for Message Sending Service');
      
      this.isRunning = true;
      this.processPendingMessages();
      
      console.log(`Message Sending Service started with polling interval: ${this.pollingInterval}ms`);
    } catch (error) {
      console.error('Failed to start Message Sending Service:', error);
      throw error;
    }
  }

  async processPendingMessages() {
    while (this.isRunning) {
      try {
        // Fetch pending messages that haven't exceeded max attempts
        const pendingMessages = await campaignDB.prisma.communication_log.findMany({
          where: {
            status: 'PENDING',
            attempts: {
              lt: campaignDB.prisma.communication_log.fields.max_attempts
            }
          },
          take: this.batchSize,
          orderBy: {
            created_at: 'asc'
          },
          include: {
            campaigns: {
              select: {
                name: true,
                campaign_type: true
              }
            },
            customers: {
              select: {
                name: true,
                email: true
              }
            }
          }
        });

        if (pendingMessages.length > 0) {
          console.log(`Processing ${pendingMessages.length} pending messages...`);
          
          for (const message of pendingMessages) {
            await this.processMessageDelivery(message);
          }
        }
      } catch (error) {
        console.error('Error processing pending messages:', error);
      }
      
      // Wait before next polling cycle
      await new Promise(resolve => setTimeout(resolve, this.pollingInterval));
    }
  }

  async processMessageDelivery(communicationLog) {
    try {
      // Update attempt count and last attempt time
      await campaignDB.prisma.communication_log.update({
        where: {
          communication_id: communicationLog.communication_id
        },
        data: {
          attempts: {
            increment: 1
          },
          last_attempt_at: new Date(),
          status: 'PROCESSING'
        }
      });

      // Prepare message payload for delivery
      const messagePayload = {
        communication_id: communicationLog.communication_id,
        campaign_id: communicationLog.campaign_id,
        customer_id: communicationLog.customer_id,
        customer_email: communicationLog.customer_email,
        customer_name: communicationLog.customer_name,
        message_text: communicationLog.message_text,
        campaign_name: communicationLog.campaigns?.name,
        campaign_type: communicationLog.campaigns?.campaign_type,
        attempt_number: communicationLog.attempts + 1,
        max_attempts: communicationLog.max_attempts,
        timestamp: new Date().toISOString()
      };

      console.log(`Processing message delivery: ${communicationLog.communication_id} (${communicationLog.customer_email})`);

      // Directly call mock receiver service
      const deliveryResponse = await mockReceiverService.sendMessage(messagePayload);
      
      console.log(`Mock service response for ${communicationLog.communication_id}: ${deliveryResponse.status}`);

      // Create delivery response for queue processing
      const responseData = {
        communication_id: communicationLog.communication_id,
        campaign_id: communicationLog.campaign_id,
        customer_id: communicationLog.customer_id,
        customer_email: communicationLog.customer_email,
        attempt_number: messagePayload.attempt_number,
        delivery_response: deliveryResponse,
        processed_at: new Date().toISOString()
      };

      // Queue the response for database update
      await rabbitMQ.publishMessage(
        'campaign_messaging',
        'response.process',
        responseData,
        {
          persistent: true,
          messageId: `response-${communicationLog.communication_id}-${Date.now()}`,
          correlationId: communicationLog.communication_id
        }
      );

      console.log(`Response queued for processing: ${communicationLog.communication_id}`);

    } catch (error) {
      console.error(`Failed to process message delivery ${communicationLog.communication_id}:`, error);
      
      // Create failed response for queue processing
      const failedResponseData = {
        communication_id: communicationLog.communication_id,
        campaign_id: communicationLog.campaign_id,
        customer_id: communicationLog.customer_id,
        customer_email: communicationLog.customer_email,
        attempt_number: communicationLog.attempts + 1,
        delivery_response: {
          status: 'ERROR',
          error_code: 'SYSTEM_ERROR',
          error_message: error.message,
          timestamp: new Date().toISOString()
        },
        processed_at: new Date().toISOString()
      };

      try {
        await rabbitMQ.publishMessage(
          'campaign_messaging',
          'response.process',
          failedResponseData,
          {
            persistent: true,
            messageId: `error-response-${communicationLog.communication_id}-${Date.now()}`,
            correlationId: communicationLog.communication_id
          }
        );
        console.log(`Error response queued for processing: ${communicationLog.communication_id}`);
      } catch (queueError) {
        console.error(`Failed to queue error response for ${communicationLog.communication_id}:`, queueError);
      }
      
      throw error;
    }
  }

  async stop() {
    console.log('Stopping Message Sending Service...');
    this.isRunning = false;
  }

  // Method to manually trigger processing (useful for testing or immediate processing)
  async triggerProcessing() {
    if (!this.isRunning) {
      console.log('Service not running, cannot trigger processing');
      return;
    }
    
    console.log('Manually triggering message processing...');
    // Process one batch immediately
    try {
      const pendingMessages = await campaignDB.prisma.communication_log.findMany({
        where: {
          status: 'PENDING',
          attempts: {
            lt: campaignDB.prisma.communication_log.fields.max_attempts
          }
        },
        take: this.batchSize,
        orderBy: {
          created_at: 'asc'
        },
        include: {
          campaigns: {
            select: {
              name: true,
              campaign_type: true
            }
          },
          customers: {
            select: {
              name: true,
              email: true
            }
          }
        }
      });

      for (const message of pendingMessages) {
        await this.processMessageDelivery(message);
      }
      
      console.log(`Manual trigger processed ${pendingMessages.length} messages`);
    } catch (error) {
      console.error('Error in manual trigger processing:', error);
      throw error;
    }
  }
}

// Create and export singleton instance
const messageSendingService = new MessageSendingService();

// Start the service if this file is run directly
if (require.main === module) {
  messageSendingService.start().catch((error) => {
    console.error('Failed to start Message Sending Service:', error);
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down Message Sending Service...`);
    await messageSendingService.stop();
    await rabbitMQ.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = messageSendingService;