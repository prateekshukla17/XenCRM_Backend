const crypto = require('crypto');

class MockReceiverService {
  constructor() {
    this.successRate = 0.9; // 90% success rate
    this.failureRate = 0.1; // 10% failure rate
    this.averageResponseTime = 500; // 500ms average response time
    this.responseTimeVariation = 300; // ±300ms variation
  }

  /**
   * Simulates sending a message to a third-party messaging service
   * @param {Object} messagePayload - The message data to send
   * @returns {Promise<Object>} - Response from the mock service
   */
  async sendMessage(messagePayload) {
    // Simulate network delay
    await this.simulateNetworkDelay();

    // Validate input
    if (!messagePayload) {
      return this.createErrorResponse('INVALID_PAYLOAD', 'Message payload is required');
    }

    if (!messagePayload.customer_email) {
      return this.createErrorResponse('MISSING_EMAIL', 'Customer email is required');
    }

    if (!messagePayload.message_text) {
      return this.createErrorResponse('MISSING_MESSAGE', 'Message text is required');
    }

    // Generate random outcome based on success rate
    const randomValue = Math.random();
    const isSuccess = randomValue <= this.successRate;

    if (isSuccess) {
      return this.createSuccessResponse(messagePayload);
    } else {
      return this.createFailureResponse(messagePayload);
    }
  }

  /**
   * Creates a successful response
   * @param {Object} messagePayload - Original message payload
   * @returns {Object} - Success response
   */
  createSuccessResponse(messagePayload) {
    const vendorMessageId = this.generateVendorMessageId();
    
    return {
      status: 'SUCCESS',
      vendor_ref: vendorMessageId,
      communication_id: messagePayload.communication_id,
      customer_email: messagePayload.customer_email,
      message: 'Message delivered successfully',
      delivered_at: new Date().toISOString(),
      cost: this.calculateMessageCost(messagePayload.message_text),
      vendor_response: {
        message_id: vendorMessageId,
        status_code: 200,
        delivery_status: 'DELIVERED',
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Creates a failure response with various failure reasons
   * @param {Object} messagePayload - Original message payload
   * @returns {Object} - Failure response
   */
  createFailureResponse(messagePayload) {
    const failureReasons = [
      {
        code: 'INVALID_EMAIL',
        message: 'Invalid email address format',
        retryable: false
      },
      {
        code: 'EMAIL_BOUNCED',
        message: 'Email address bounced',
        retryable: false
      },
      {
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded',
        retryable: true
      },
      {
        code: 'TEMPORARY_FAILURE',
        message: 'Temporary service unavailable',
        retryable: true
      },
      {
        code: 'SPAM_DETECTED',
        message: 'Message flagged as spam',
        retryable: false
      },
      {
        code: 'QUOTA_EXCEEDED',
        message: 'Daily quota exceeded',
        retryable: true
      }
    ];

    // Select a random failure reason
    const randomFailure = failureReasons[Math.floor(Math.random() * failureReasons.length)];
    const vendorMessageId = this.generateVendorMessageId();

    return {
      status: 'FAILED',
      vendor_ref: vendorMessageId,
      communication_id: messagePayload.communication_id,
      customer_email: messagePayload.customer_email,
      error_code: randomFailure.code,
      error_message: randomFailure.message,
      retryable: randomFailure.retryable,
      failed_at: new Date().toISOString(),
      vendor_response: {
        message_id: vendorMessageId,
        status_code: randomFailure.retryable ? 429 : 400,
        delivery_status: 'FAILED',
        error_details: randomFailure.message,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Creates an error response for invalid requests
   * @param {string} errorCode - Error code
   * @param {string} errorMessage - Error message
   * @returns {Object} - Error response
   */
  createErrorResponse(errorCode, errorMessage) {
    return {
      status: 'ERROR',
      error_code: errorCode,
      error_message: errorMessage,
      timestamp: new Date().toISOString(),
      vendor_response: {
        status_code: 400,
        error: errorMessage
      }
    };
  }

  /**
   * Generates a unique vendor message ID
   * @returns {string} - Vendor message ID
   */
  generateVendorMessageId() {
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(4).toString('hex');
    return `vendor_${timestamp}_${randomString}`;
  }

  /**
   * Calculates message cost based on content (mock calculation)
   * @param {string} messageText - Message content
   * @returns {number} - Cost in cents
   */
  calculateMessageCost(messageText) {
    // Base cost: $0.01 per message
    const baseCost = 1;
    
    // Additional cost for longer messages
    const lengthMultiplier = Math.ceil(messageText.length / 160); // SMS segment calculation
    
    return baseCost * lengthMultiplier;
  }

  /**
   * Simulates network delay with random variation
   * @returns {Promise<void>}
   */
  async simulateNetworkDelay() {
    // Calculate random delay within the specified range
    const variation = (Math.random() - 0.5) * 2 * this.responseTimeVariation;
    const delay = Math.max(50, this.averageResponseTime + variation); // Minimum 50ms
    
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Updates the success/failure rates for testing purposes
   * @param {number} successRate - New success rate (0-1)
   */
  updateSuccessRate(successRate) {
    if (successRate < 0 || successRate > 1) {
      throw new Error('Success rate must be between 0 and 1');
    }
    
    this.successRate = successRate;
    this.failureRate = 1 - successRate;
    
    console.log(`Updated success rate to ${successRate * 100}%`);
  }

  /**
   * Gets current service statistics
   * @returns {Object} - Service statistics
   */
  getStats() {
    return {
      successRate: this.successRate,
      failureRate: this.failureRate,
      averageResponseTime: this.averageResponseTime,
      responseTimeVariation: this.responseTimeVariation
    };
  }

  /**
   * Simulates webhook delivery status updates (for future use)
   * @param {string} vendorMessageId - Vendor message ID
   * @returns {Object} - Status update
   */
  async getDeliveryStatus(vendorMessageId) {
    await this.simulateNetworkDelay();
    
    const statuses = [
      'SENT', 'DELIVERED', 'READ', 'CLICKED'
    ];
    
    const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
    
    return {
      vendor_ref: vendorMessageId,
      status: randomStatus,
      updated_at: new Date().toISOString(),
      details: {
        delivery_time: Math.floor(Math.random() * 300) + 10, // 10-310 seconds
        user_agent: this.generateRandomUserAgent()
      }
    };
  }

  /**
   * Generates random user agent for testing
   * @returns {string} - Random user agent
   */
  generateRandomUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)',
      'Mozilla/5.0 (Android 11; Mobile)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    ];
    
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }
}

// Create and export singleton instance
const mockReceiverService = new MockReceiverService();

module.exports = mockReceiverService;