const { campaignDB } = require('../../../shared/database');
const rabbitMQ = require('../../../shared/utils/rabbitmq');

class ResponseProcessingConsumer {
  constructor() {
    this.queueName = 'message_response_queue';
  }

  async start() {
    try {
      console.log('Starting Response Processing Consumer...');

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
        this.processDeliveryResponse.bind(this),
        {
          noAck: false,
          prefetch: 10, // Process up to 10 responses concurrently
        }
      );

      console.log(
        `Response Processing Consumer started. Listening on queue: ${this.queueName}`
      );
    } catch (error) {
      console.error('Failed to start Response Processing Consumer:', error);
      throw error;
    }
  }

  async processDeliveryResponse(responseContent, message) {
    try {
      console.log(`Processing delivery response for communication: ${responseContent.communication_id}`);
      
      // Validate response structure
      if (!responseContent.communication_id) {
        throw new Error('Invalid response format: missing communication_id');
      }

      if (!responseContent.delivery_response) {
        throw new Error('Invalid response format: missing delivery_response');
      }

      // Extract delivery response
      const deliveryResponse = responseContent.delivery_response;

      // Update communication log with response data
      await this.updateCommunicationLog(responseContent, deliveryResponse);
      
      // Create delivery receipt record
      await this.createDeliveryReceipt(responseContent, deliveryResponse);
      
      // Update campaign stats based on response status
      if (deliveryResponse.status === 'SUCCESS') {
        await this.updateCampaignStats(responseContent.campaign_id, 'delivered');
      } else if (deliveryResponse.status === 'FAILED' || deliveryResponse.status === 'ERROR') {
        await this.updateCampaignStats(responseContent.campaign_id, 'failed');
      }

      console.log(`Response processed successfully for communication: ${responseContent.communication_id}`);
      
    } catch (error) {
      console.error('Error processing delivery response:', error.message);
      throw error;
    }
  }

  /**
   * Updates the communication_log table with delivery status
   * @param {Object} receiptContent - Delivery receipt data
   * @returns {Promise<void>}
   */
  async updateCommunicationLog(responseContent, deliveryResponse) {
    try {
      const updateData = {
        vendor_ref: deliveryResponse.vendor_ref,
        last_attempt_at: new Date()
      };

      // Set status and timestamps based on delivery response
      if (deliveryResponse.status === 'SUCCESS') {
        updateData.status = 'DELIVERED';
        updateData.delivered_at = deliveryResponse.delivered_at ? 
          new Date(deliveryResponse.delivered_at) : new Date();
      } else if (deliveryResponse.status === 'FAILED' || deliveryResponse.status === 'ERROR') {
        updateData.status = 'FAILED';
        
        // Check if message should be retried
        const currentLog = await campaignDB.prisma.communication_log.findUnique({
          where: { communication_id: responseContent.communication_id },
          select: { attempts: true, max_attempts: true }
        });

        const isRetryable = deliveryResponse.retryable || (deliveryResponse.status === 'ERROR' && deliveryResponse.error_code === 'SYSTEM_ERROR');
        
        if (currentLog && isRetryable && currentLog.attempts < currentLog.max_attempts) {
          // Reset status to PENDING for retry if retryable and under max attempts
          updateData.status = 'PENDING';
          console.log(`Message ${responseContent.communication_id} marked for retry (attempt ${currentLog.attempts}/${currentLog.max_attempts})`);
        } else {
          // Mark as permanently failed
          updateData.status = 'FAILED';
          console.log(`Message ${responseContent.communication_id} permanently failed`);
        }
      }

      // Update the communication log
      const updatedLog = await campaignDB.prisma.communication_log.update({
        where: {
          communication_id: responseContent.communication_id
        },
        data: updateData
      });

      console.log(`Communication log updated for ${responseContent.communication_id}: status=${updatedLog.status}, attempts=${updatedLog.attempts}`);

    } catch (error) {
      console.error(`Failed to update communication log for ${responseContent.communication_id}:`, error);
      throw new Error(`Failed to update communication log: ${error.message}`);
    }
  }

  /**
   * Creates a delivery receipt record in the database
   * @param {Object} receiptContent - Delivery receipt data
   * @returns {Promise<void>}
   */
  async createDeliveryReceipt(responseContent, deliveryResponse) {
    try {
      const receiptData = {
        communication_id: responseContent.communication_id,
        vendor_ref: deliveryResponse.vendor_ref || null,
        receipt_status: deliveryResponse.status === 'SUCCESS' ? 'DELIVERED' : 'FAILED',
        failure_reason: deliveryResponse.error_message || null,
        received_at: deliveryResponse.delivered_at || deliveryResponse.failed_at || responseContent.processed_at ? 
          new Date(deliveryResponse.delivered_at || deliveryResponse.failed_at || responseContent.processed_at) : 
          new Date(),
        processed: false // Will be set to true after processing
      };

      // Create the delivery receipt
      const deliveryReceipt = await campaignDB.prisma.delivery_receipts.create({
        data: receiptData
      });

      console.log(`Delivery receipt created: ${deliveryReceipt.receipt_id}`);

      // Add to receipt processing queue for tracking
      await campaignDB.prisma.receipt_processing_queue.create({
        data: {
          receipt_id: deliveryReceipt.receipt_id,
          status: 'COMPLETED',
          processed_at: new Date()
        }
      });

      // Mark receipt as processed
      await campaignDB.prisma.delivery_receipts.update({
        where: { receipt_id: deliveryReceipt.receipt_id },
        data: { processed: true }
      });

    } catch (error) {
      console.error(`Failed to create delivery receipt for ${responseContent.communication_id}:`, error);
      throw new Error(`Failed to create delivery receipt: ${error.message}`);
    }
  }

  /**
   * Updates campaign statistics based on delivery results
   * @param {string} campaignId - Campaign ID
   * @param {string} result - Result type ('delivered' or 'failed')
   * @returns {Promise<void>}
   */
  async updateCampaignStats(campaignId, result) {
    try {
      // Use upsert to handle cases where campaign_stats doesn't exist yet
      const updateData = {
        last_updated: new Date()
      };

      if (result === 'delivered') {
        updateData.total_delivered = { increment: 1 };
      } else if (result === 'failed') {
        updateData.total_failed = { increment: 1 };
      }

      await campaignDB.prisma.campaign_stats.upsert({
        where: { campaign_id: campaignId },
        update: updateData,
        create: {
          campaign_id: campaignId,
          total_sent: 0,
          total_delivered: result === 'delivered' ? 1 : 0,
          total_failed: result === 'failed' ? 1 : 0,
          last_updated: new Date()
        }
      });

      // Also update campaign delivery summary
      const summaryUpdateData = {
        last_updated: new Date()
      };

      if (result === 'delivered') {
        summaryUpdateData.delivered_count = { increment: 1 };
        summaryUpdateData.sent_count = { increment: 1 };
        summaryUpdateData.pending_count = { decrement: 1 };
      } else if (result === 'failed') {
        summaryUpdateData.failed_count = { increment: 1 };
        summaryUpdateData.sent_count = { increment: 1 };
        summaryUpdateData.pending_count = { decrement: 1 };
      }

      await campaignDB.prisma.campaign_delivery_summary.upsert({
        where: { campaign_id: campaignId },
        update: summaryUpdateData,
        create: {
          campaign_id: campaignId,
          total_messages: 0,
          pending_count: 0,
          sent_count: 1,
          delivered_count: result === 'delivered' ? 1 : 0,
          failed_count: result === 'failed' ? 1 : 0,
          last_updated: new Date()
        }
      });

      console.log(`Campaign stats updated for ${campaignId}: ${result}`);

    } catch (error) {
      console.error(`Failed to update campaign stats for ${campaignId}:`, error);
      // Don't throw error here as it's not critical for message processing
      console.warn('Campaign stats update failed, but receipt processing continues');
    }
  }

  /**
   * Handles retry logic for failed receipts that should be retried
   * @param {string} communicationId - Communication ID
   * @returns {Promise<void>}
   */
  async scheduleRetry(communicationId) {
    try {
      // Reset status to PENDING and update last_attempt_at
      await campaignDB.prisma.communication_log.update({
        where: { communication_id: communicationId },
        data: {
          status: 'PENDING',
          last_attempt_at: new Date()
        }
      });

      console.log(`Scheduled retry for communication: ${communicationId}`);

    } catch (error) {
      console.error(`Failed to schedule retry for ${communicationId}:`, error);
      throw error;
    }
  }

  /**
   * Gets processing statistics
   * @returns {Promise<Object>} - Processing statistics
   */
  async getProcessingStats() {
    try {
      const stats = await campaignDB.prisma.delivery_receipts.groupBy({
        by: ['receipt_status'],
        _count: {
          receipt_id: true
        },
        where: {
          received_at: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        }
      });

      const processedCount = await campaignDB.prisma.receipt_processing_queue.count({
        where: {
          status: 'COMPLETED',
          processed_at: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
          }
        }
      });

      return {
        last24Hours: {
          receiptsProcessed: processedCount,
          statusBreakdown: stats.reduce((acc, stat) => {
            acc[stat.receipt_status] = stat._count.receipt_id;
            return acc;
          }, {})
        },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Failed to get processing stats:', error);
      return {
        error: 'Failed to retrieve stats',
        timestamp: new Date().toISOString()
      };
    }
  }

  async stop() {
    console.log('Stopping Response Processing Consumer...');
    // Note: RabbitMQ consumer will stop automatically when connection is closed
  }
}

// Create and export singleton instance
const responseProcessingConsumer = new ResponseProcessingConsumer();

// Start the consumer if this file is run directly
if (require.main === module) {
  responseProcessingConsumer.start().catch((error) => {
    console.error('Failed to start Response Processing Consumer:', error);
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    await responseProcessingConsumer.stop();
    await rabbitMQ.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = responseProcessingConsumer;
