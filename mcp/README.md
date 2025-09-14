# XenCRM MCP Server

A Model Context Protocol (MCP) server that enables AI assistants to interact with the XenCRM Backend system through natural language commands.

## 🚀 Features

### 🛠️ Available Tools

#### 1. **Add Customer** (`add_customer`)
Add new customers to the CRM system with support for natural language input.

**Example Usage:**
- *"Add a new customer named Rohan with ₹5000 spend and 3 visits."*
- *"Create customer John Doe with email john@example.com"*

**Parameters:**
- `name` (required): Customer's full name
- `email` (required): Valid email address
- `phone` (optional): Phone number
- `total_spend` (optional): Initial spend amount in INR
- `total_visits` (optional): Initial visit count
- `status` (optional): ACTIVE or INACTIVE

#### 2. **Add Order** (`add_order`)
Record new orders for existing customers.

**Example Usage:**
- *"Record an order of ₹1200 for user2@example.com"*
- *"Add order worth ₹5000 for customer ID abc-123-def"*

**Parameters:**
- `customer_email` OR `customer_id` (required): Customer identifier
- `order_amount` (required): Order amount in INR (positive number)
- `order_status` (optional): COMPLETED, PENDING, or CANCELLED

## 🏗️ Architecture

```
AI Assistant (Claude/ChatGPT)
    ↓ (Natural Language)
XenCRM MCP Server
    ↓ (Database Operations)
PostgreSQL Databases
    ├── Customer DB (customers, orders, outbox_events)
    └── Campaign DB (campaigns, communication_logs)
```

## 🛠️ Setup & Installation

### Prerequisites
- Node.js 18+
- TypeScript
- PostgreSQL databases (Customer & Campaign)
- Environment variables configured

### 1. Install Dependencies
```bash
cd mcp
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your database credentials
```

### 3. Build the Server
```bash
npm run build
```

### 4. Start the Server
```bash
npm start
```

## 🔧 Development

### Watch Mode
```bash
npm run dev
```

### Clean Build
```bash
npm run clean && npm run build
```

## 🎯 Usage Examples

### Adding Customers

```javascript
// Natural language examples that work:
"Add a new customer named Rohan Kumar with email rohan@example.com"
"Create customer Priya Sharma (priya@test.com) with ₹10,000 initial spend"
"Add customer: Name=John Doe, Email=john@company.com, Phone=+91-9876543210"
```

### Recording Orders

```javascript
// Natural language examples that work:
"Record an order of ₹1200 for user2@example.com"
"Add order worth ₹5,500 for rohan@example.com with status PENDING"
"Create order: Amount=₹3000, Customer=priya@test.com, Status=COMPLETED"
```

## 🔍 Response Format

The server provides rich, formatted responses:

### Successful Customer Addition
```
✅ **Customer Added Successfully!**

**Customer Details:**
• **Name:** Rohan Kumar
• **Email:** rohan@example.com
• **Phone:** +91-9876543210
• **Total Spend:** ₹5,000.00
• **Total Visits:** 3
• **Status:** ACTIVE
• **Customer ID:** a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6
• **Created:** 14 September 2025, 17:45

The customer has been added to the CRM system and is ready for orders and campaigns.
```

### Successful Order Addition
```
✅ **Order Recorded Successfully!**

**Order Details:**
• **Order ID:** x1y2z3a4-b5c6-7d8e-9f0g-h1i2j3k4l5m6
• **Amount:** ₹1,200.00
• **Status:** COMPLETED
• **Date:** 14 September 2025, 17:46

**Customer Information:**
• **Name:** Rohan Kumar
• **Email:** rohan@example.com
• **Total Spend:** ₹6,200.00
• **Total Visits:** 4
• **Last Order:** 14 September 2025, 17:46

The order has been recorded and customer statistics have been updated automatically.
```

## 🗃️ Database Integration

### Automatic Operations
- **Customer Stats Update**: Orders automatically update customer spend and visit counts
- **Outbox Events**: Creates events for downstream processing (campaigns, analytics)
- **Data Validation**: Comprehensive validation using Zod schemas
- **Error Handling**: Graceful error handling with descriptive messages

### Database Tables Used
- `customers`: Core customer information
- `orders`: Order records with customer relationships
- `outbox_events`: Events for microservice communication

## 🔐 Security Features

- **Input Validation**: Zod schemas validate all inputs
- **SQL Injection Protection**: Prisma ORM provides built-in protection  
- **Type Safety**: Full TypeScript typing throughout
- **Error Isolation**: Errors don't expose sensitive information

## 🧪 Testing

### Manual Testing
```bash
# Start the MCP server
npm start

# Use with AI assistant or test directly
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' | node build/index.js
```

### Test Customer Creation
```bash
# Through AI assistant:
"Add a new customer named Test User with email test@example.com and ₹1000 spend"
```

### Test Order Creation
```bash
# Through AI assistant:
"Record an order of ₹500 for test@example.com"
```

## 📊 Monitoring & Logging

### Health Checks
The server performs automatic health checks on:
- Database connectivity
- Prisma client status
- Environment configuration

### Error Handling
- Comprehensive error catching
- Structured error messages
- Graceful degradation

## 🔄 Integration with AI Assistants

### Claude (Anthropic)
```json
{
  "mcpServers": {
    "xencrm": {
      "command": "node",
      "args": ["/path/to/XenCRM_Backend/mcp/build/index.js"],
      "env": {
        "CUSTOMER_DATABASE_URL": "postgresql://...",
        "CAMPAIGN_DATABASE_URL": "postgresql://..."
      }
    }
  }
}
```

### ChatGPT (OpenAI)
Similar configuration through MCP client setup.

## 🚨 Troubleshooting

### Common Issues

1. **Database Connection Failed**
   ```
   ❌ Failed to start XenCRM MCP Server: Database health check failed
   ```
   - Check database URLs in `.env`
   - Ensure PostgreSQL is running
   - Verify database permissions

2. **Module Import Errors**
   ```
   Cannot find module '.prisma/customer-client'
   ```
   - Run `npm run build` from parent directory
   - Ensure Prisma clients are generated

3. **Permission Errors**
   ```
   permission denied, open '.env'
   ```
   - Check file permissions
   - Ensure `.env` exists and is readable

### Debug Mode
```bash
# Enable debug logging
DEBUG=xencrm:* npm start
```

## 🔮 Future Enhancements

- **Search Customers**: Find customers by name, email, or criteria
- **Customer Analytics**: Get detailed customer insights
- **Campaign Management**: Create and manage marketing campaigns
- **Order Analytics**: Analyze order patterns and trends
- **Bulk Operations**: Import/export customer data
- **Webhook Support**: Real-time notifications for external systems

## 📈 Performance

- **Connection Pooling**: Prisma handles database connections efficiently
- **Input Validation**: Fast Zod validation with detailed error messages
- **Memory Efficient**: Minimal memory footprint for MCP protocol
- **Error Recovery**: Graceful handling of database disconnections

---

**Version**: 1.0.0  
**Compatible with**: Claude Desktop, ChatGPT with MCP support  
**Database**: PostgreSQL 12+  
**Node.js**: 18+