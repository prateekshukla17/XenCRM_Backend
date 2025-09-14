# Campaign Messaging System

## Overview

The Campaign Messaging System is a comprehensive solution for sending campaign messages with delivery tracking, retry logic, and status management. It consists of multiple services that work together to ensure reliable message delivery.

## Architecture

```
┌─────────────────┐    ┌──────────────────┐
│ Communication   │    │ Send Campaign    │     Request
│ Logs (PENDING)  │───▶│ Messages         │─────────────▶┌─────────────────────┐
└─────────────────┘    │ Producer         │                    │ Mock Delivery       │
                       └──────────────────┘                    │ Backend (90% succ.) │
                                │                       └─────────────────────┘
                                │ Response                        │
                                ▼                                 │
┌─────────────────┐    ┌──────────────────┐                 │
│ Communication   │    │ Producer         │◀─────────────────┘
│ Logs (UPDATED)  │◀───│                  │ success/failure
└─────────────────┘    │ (Queues Response)│
          │          └──────────────────┘
          │                       │
    updates db                   ▼
          │          ┌──────────────────┐
          │          │ Response Queue   │
          │          └──────────────────┘
          │                       │
          │                       ▼
          │          ┌──────────────────┐
          └──────────│ Consumer         │
                     └──────────────────┘
```

## Components

### 1. Message Sending Service (`services/messageSendingService.js`)
- **Purpose**: Producer that polls database and directly calls Mock API
- **Functionality**:
  - Fetches pending messages in batches
  - Updates attempt counts
  - Directly calls Mock Receiver Service
  - Queues responses for database updates

### 2. Mock Receiver Service (`services/mockReceiverService.js`)
- **Purpose**: Simulates a third-party messaging API
- **Functionality**:
  - 90% success rate, 10% failure rate (configurable)
  - Various failure scenarios (bounced emails, rate limits, spam detection)
  - Network delay simulation
  - Cost calculation

### 3. Response Processing Consumer (`consumers/responseProcessingConsumer.js`)
- **Purpose**: Consumer that updates database with delivery results
- **Functionality**:
  - Consumes from message_response_queue
  - Updates communication_logs status
  - Creates delivery_receipts records
  - Updates campaign statistics
  - Handles retry logic for failed deliveries

### 4. Messaging Orchestrator (`messagingOrchestrator.js`)
- **Purpose**: Coordinates all messaging services
- **Functionality**:
  - Starts/stops all services
  - Health monitoring
  - Manual processing triggers
  - Graceful shutdown

## Database Schema

### Communication Log Fields Updated
- `status`: PENDING → PROCESSING → DELIVERED/FAILED
- `attempts`: Incremented with each delivery attempt
- `vendor_ref`: Set from successful delivery response
- `last_attempt_at`: Updated on each attempt
- `delivered_at`: Set when successfully delivered

### New Records Created
- `delivery_receipts`: Detailed delivery information
- `receipt_processing_queue`: Processing tracking

## RabbitMQ Infrastructure

### New Exchanges and Queues
- **Exchange**: `campaign_messaging`
  - **Queue**: `message_response_queue` (routing key: `response.process`)

## Usage

### Starting the System

#### Option 1: Start All Services (Recommended)
```bash
# From the campaign service directory
node messagingOrchestrator.js
```

#### Option 2: Start Individual Services
```bash
# Message Sending Service
node services/messageSendingService.js

# Response Processing Consumer
node consumers/responseProcessingConsumer.js
```

### Configuration

#### Mock Receiver Service Configuration
```javascript
const mockReceiverService = require('./services/mockReceiverService');

// Change success rate (0.0 to 1.0)
mockReceiverService.updateSuccessRate(0.95); // 95% success rate

// Get current stats
const stats = mockReceiverService.getStats();
console.log(stats);
```

#### Message Sending Service Configuration
```javascript
const messageSendingService = require('./services/messageSendingService');

// Manually trigger processing (for testing)
await messageSendingService.triggerProcessing();
```

### Health Monitoring
```javascript
const orchestrator = require('./messagingOrchestrator');

// Get system health
const health = await orchestrator.getSystemHealth();
console.log(health);

// Manually trigger processing
await orchestrator.triggerMessageProcessing();
```

## Message Flow

1. **Pending Messages**: Communication logs with `status = 'PENDING'`
2. **Polling**: Message Sending Service polls database every 5 seconds
3. **Direct API Call**: Service directly calls Mock Receiver Service (90% success)
4. **Response Queuing**: API responses queued to `message_response_queue`
5. **Response Processing**: Response Processing Consumer updates database
6. **Status Update**: Communication logs updated with final status

## Status Transitions

```
PENDING → PROCESSING → DELIVERED ✅
PENDING → PROCESSING → FAILED (retryable) → PENDING → ...
PENDING → PROCESSING → FAILED (non-retryable) ❌
```

## Retry Logic

### Message Level Retries
- Max attempts: 3 (configurable in communication_log.max_attempts)
- Retryable failures: Rate limits, temporary service issues
- Non-retryable failures: Invalid email, spam detection

### Queue Level Retries
- RabbitMQ built-in retry mechanisms
- Dead letter queues for failed processing

## Monitoring and Logging

### Key Logs to Monitor
- Message processing counts
- Delivery success/failure rates
- Queue depths
- Processing times
- Error rates

### Statistics Available
```javascript
// Get processing statistics
const stats = await responseProcessingConsumer.getProcessingStats();
console.log(stats);
// {
//   last24Hours: {
//     receiptsProcessed: 150,
//     statusBreakdown: {
//       DELIVERED: 135,
//       FAILED: 15
//     }
//   }
// }
```

## Error Handling

### Service Level Errors
- Database connection failures
- RabbitMQ connection issues
- Message processing errors

### Message Level Errors
- Invalid message format
- Mock API failures
- Database update failures

### Recovery Mechanisms
- Automatic reconnection to RabbitMQ
- Message retry logic
- Graceful degradation

## Testing

### Manual Testing
```bash
# Start the orchestrator
node messagingOrchestrator.js

# In another terminal, trigger processing
node -e "
const orchestrator = require('./messagingOrchestrator');
(async () => {
  await orchestrator.triggerMessageProcessing();
})();
"
```

### Database Setup for Testing
```sql
-- Insert test communication log
INSERT INTO communication_log (
  campaign_id, customer_id, customer_email, customer_name, 
  message_text, status
) VALUES (
  'your-campaign-id', 'your-customer-id', 'test@example.com', 
  'Test User', 'Hello, this is a test message!', 'PENDING'
);
```

## Performance Considerations

- **Batch Size**: Message Sending Service processes 10 messages per batch
- **Concurrency**: Delivery Consumer handles 5 concurrent messages
- **Polling Interval**: 5 seconds for pending message polling
- **Queue Prefetch**: Configurable per consumer

## Environment Variables Required

```bash
# RabbitMQ Connection
RabbitMQ_URL=amqp://localhost:5672

# Database Connection (already configured)
CAMPAIGN_DATABASE_URL=postgresql://...
```

## Troubleshooting

### Common Issues

1. **RabbitMQ Connection Failed**
   - Check RabbitMQ service is running
   - Verify connection URL and credentials

2. **Messages Not Processing**
   - Check queue depths in RabbitMQ management
   - Verify consumer services are running
   - Check database connectivity

3. **High Failure Rates**
   - Adjust mock service success rate for testing
   - Check message validation logic
   - Review retry logic configuration

### Debug Mode
Set environment variable for detailed logging:
```bash
DEBUG=campaign-messaging node messagingOrchestrator.js
```