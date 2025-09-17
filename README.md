# XenCRM Backend

An end-to-end Customer Relationship Management (CRM) system built as part of the Xeno SDE Internship Assignment – 2025. The project demonstrates modern engineering practices: microservices architecture, event-driven design, full-stack development, and AI-first integrations.

## Architecture Overview

XenCRM follows a microservices architecture with:

### Ingestion Microservice

**Purpose**: Manages customer data, orders, and generates events to update DB

- Provides APIs (/customers, /orders) to add customer & order data.
- Publishes events to RabbitMQ queues (Customer Queue, Orders Queue).
- Master DB stores raw customer & order data.
- Write-Heavy Operations on the Database.
  ![Ingestion](./readme_resources/ingestionms.png)

### Message Delivery Microservice

**Purpose**: Handles Message delivery for Campaigns, and delivery tracking.

- Reads Communication_Logs from Business DB.
- Sends personalized campaign messages via a Producer → Mock Vendor API.
- Vendor API responds with delivery status (90% success / 10% fail).
- Delivery receipts are pushed to a Receipt Update Queue, consumed to update logs in Business DB.
- Read Heavy Operations on the Database.
  ![Delivery](./readme_resources/deliveryms.png)

### Frontend - [LinkToRepo](https://github.com/prateekshukla17/XenCRM_Frontend)

- Authenticated via Google OAuth (NextAuth).
- Provides UI to create segments, create campaigns, and view dashboards.
- Communicates with Campaigns DB via APIs (/segments, /campaigns, /dashboard, /campaignStats).

  ![Frontend](./readme_resources/frontend.png)

## Architecture Reasoning

Ingestion service (Master DB)

- System of record: strong transactional guarantees for customers & orders.
- Optimized for writes and intergrity.
- Publishes events about state changes.

Functional / Campaign service (Business DB)

- Owns segments, campaigns, communication_log, and a denormalized customer_mv for fast read queries.
- Optimized for complex read queries (segmentation) and campaign delivery.
- Isolated schema means we can evolve it (indexes, materialized views, different DB engine) without touching ingestion.

Why this split:

- separates write/load patterns (write-heavy ingestion vs read-heavy campaign queries)
- Resilience & scalability — decouples producers and consumers so ingestion traffic doesn’t slow down campaigns.

## Technologies Used

- Node.js – Runtime environment.

- Express.js – REST API framework.

- Prisma – ORM for PostgreSQL.

- Model Context Protocol - Exposing APIs to Natural Language.

- PostgreSQL(neonDB) – Primary relational database.

- RabbitMQ – Message broker for event-driven communication.

## Database Schemas

### MasterDB

```sql
customers (customer_id, name, email, phone, total_spend, total_visits, status)
orders (order_id, customer_id, order_amount, order_status, created_at)
```

![MasterDb](./readme_resources/masterdb.png)

### BusinessDb

```sql
campaigns (campaign_id, segment_id, name, message_template, status)
communication_log (communication_id, campaign_id, customer_id, message_text, status, attempts)
delivery_receipts (receipt_id, communication_id, vendor_ref, receipt_status)
segments (segment_id, name, description, rules, preview_count)
campaign_stats (campaign_id, total_sent, total_delivered, delivery_rate)
customers_mv (customer_id, name, email, total_spend, synced_at)
```

![BusinessDb](./readme_resources/businessdb.png)

## RabbitMQ Setup

- **Exchange**: `data_ingestion` (for customer data)
- **Exchange**: `campaign_messaging` (for message responses)

### Queues

- `customer_ingestion_queue` - Customer data updates
- `order_ingestion_queue` - Order data updates
- `customer_mv_queue` - Customer materialized view updates
- `message_response_queue` - Message delivery responses

## MCP Server!

### Overview

The XenCRM MCP (Model Context Protocol) Server enables AI assistants like Claude to interact with your CRM system through natural language commands.

### Available Tools

#### 1. Add Customer (`add_customer`)

**Natural Language Examples:**

- _"Add a new customer named Rohan with ₹5000 spend and 3 visits."_
- _"Create customer John Doe with email john@example.com"_

#### 2. Add Order (`add_order`)

**Natural Language Examples:**

- _"Record an order of ₹1200 for user2@example.com"_
- _"Add order worth ₹5000 for customer ID abc-123-def"_

#### 3. List Campaigns (`list_campaings`)

- _"Show me all Campaigns"_
- _"Show me only actice campaigns"_

#### 4. List Segments(`list_segments`)

- _"Show me all customer segments"_

#### 5. Create Campaigns(`create_campaing)

- _"Create promotional campaign 'Festival Sale' for segment high-value-customers with message 'Exclusive for you {name}! 40% off everything!' created by Admin"_

## Project Structure

```
XenCRM_Backend/
├── services/
│   ├── Customer/           # Ingestion (customer/order) service.
│   │   ├── prisma/         # Ingestion database schema
│   │   ├── consumers/      # RabbitMQ message consumers (Orders,Customers)
│   │   ├── controllers/    # API controllers for customer/order APIs
│   │   └── routes/         # API routes
│   └── Campaign/           # Campaign management & messaging service
│       ├── prisma/         # Campaign database schema
│       ├── consumers/      # Message processing consumers
│       ├── services/       # Business logic services
│       └── messagingOrchestrator.js  # Main messaging coordinator
├── shared/
│   ├── database.js         # Multi-database connection manager
│   ├── utils/
│   │   └── rabbitmq.js     # RabbitMQ connection & queue management
│   └── types/
│       └── events.js       # Event type definitions for RabbitMQ events
└── mcp/                    # Model Context Protocol server
    ├── src/                # TypeScript source code
    │   ├── index.ts        # Main MCP server
    │   ├── database.ts     # Database service layer
    │   └── schemas.ts      # Validation schemas
    ├── build/              # Compiled JavaScript
```

### Prerequisites

- Node.js 18+
- PostgreSQL
- RabbitMQ
- Docker (optional)

### Environment Variables

```bash
# Customer Service
CUSTOMER_DATABASE_URL=postgreSQL_db_URL
# Campaign Service
CAMPAIGN_DATABASE_URL=postgreSQL_db_URL

# RabbitMQ
RabbitMQ_URL=amqp://localhost:5672
```

### Installation

```bash
# Install dependencies
npm install

# Generate Prisma clients
npx prisma generate --schema=./services/Customer/prisma/schema.prisma
npx prisma generate --schema=./services/Campaign/prisma/schema.prisma

# Customer MV Consumer
cd services/Campaign
node consumers/customer_mv_consumer.js

#Start the Ingestion Server
cd services/Customer/routes
node index.js

# Start the Customer & order Consumers
cd services/Customer/Consumers
node customer_consumer.js
node order_consumer.js

# Start the message delivery service
cd services/Campaign
node messagingOrchestrator.js
```

## Limitations & TradeOffs

- Redundacy : I intentionally kept certain tables denormalised, to speed up aggregration queires, also to reduce number of joins, which may scan large customer databases.

- Microservices: Adds complexity, multiple databases, queue, eventual consistency problems, a Monolith would have been simpler for a small project.

- Production Costs: Extra Compute costs for an extra database(for this project Neon DB is free till a certain limit.)

- Multiple Services: Running multiple processes for development -> containerization the application would be and future scope and better practise for production enviroments.

- AI Integeration(MCP Server) : Needs an external client like CLAUDE DESKTOP, for future scope, building and MCP to directly intergrating into the web application.

### Credits

Built with sleepless nights, multiple Red Bulls and determination, by Prateek Shukla :)
