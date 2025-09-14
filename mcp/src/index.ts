#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { dbService } from './database.js';
import {
  AddCustomerToolSchema,
  AddOrderToolSchema,
  formatCurrency,
  formatDate,
  parseCustomerFromText,
  parseOrderFromText,
} from './schemas.js';
import { z } from 'zod';

// Server configuration
const SERVER_INFO = {
  name: 'xencrm-mcp-server',
  version: '1.0.0',
};

class XenCRMServer {
  private server: Server;

  constructor() {
    this.server = new Server(SERVER_INFO, {
      capabilities: {
        tools: {},
      },
    });

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'add_customer',
            description:
              'Add a new customer to the CRM system. Supports natural language input like "Add a new customer named Rohan with ₹5000 spend and 3 visits."',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Full name of the customer',
                },
                email: {
                  type: 'string',
                  format: 'email',
                  description: 'Email address of the customer',
                },
                phone: {
                  type: 'string',
                  description: 'Phone number of the customer (optional)',
                },
                total_spend: {
                  type: 'number',
                  minimum: 0,
                  description: 'Initial total spend amount in INR (optional)',
                },
                total_visits: {
                  type: 'number',
                  minimum: 0,
                  description: 'Initial total visits count (optional)',
                },
                status: {
                  type: 'string',
                  enum: ['ACTIVE', 'INACTIVE'],
                  description: 'Customer status (optional, defaults to ACTIVE)',
                },
              },
              required: ['name', 'email'],
            },
          },
          {
            name: 'add_order',
            description:
              'Record a new order for a customer. Supports natural language input like "Record an order of ₹1200 for user2@example.com."',
            inputSchema: {
              type: 'object',
              properties: {
                customer_email: {
                  type: 'string',
                  format: 'email',
                  description:
                    'Email of the customer (use this OR customer_id)',
                },
                customer_id: {
                  type: 'string',
                  format: 'uuid',
                  description:
                    'UUID of the customer (use this OR customer_email)',
                },
                order_amount: {
                  type: 'number',
                  minimum: 0.01,
                  description: 'Amount of the order in INR (must be positive)',
                },
                order_status: {
                  type: 'string',
                  enum: ['COMPLETED', 'PENDING', 'CANCELLED'],
                  description:
                    'Status of the order (optional, defaults to COMPLETED)',
                },
              },
              required: ['order_amount'],
              oneOf: [
                { required: ['customer_email'] },
                { required: ['customer_id'] },
              ],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'add_customer':
            return await this.handleAddCustomer(args);
          case 'add_order':
            return await this.handleAddOrder(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleAddCustomer(args: any) {
    // Parse and validate arguments
    let customerData;

    try {
      customerData = AddCustomerToolSchema.parse(args);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');
        throw new Error(`Invalid customer data: ${issues}`);
      }
      throw error;
    }

    // Create customer in database
    const customer = await dbService.createCustomer(customerData);

    // Format response
    const responseText = [
      `✅ **Customer Added Successfully!**`,
      ``,
      `**Customer Details:**`,
      `• **Name:** ${customer.name}`,
      `• **Email:** ${customer.email}`,
      `• **Phone:** ${customer.phone || 'Not provided'}`,
      `• **Total Spend:** ${formatCurrency(
        customer.total_spend?.toNumber() || 0
      )}`,
      `• **Total Visits:** ${customer.total_visits || 0}`,
      `• **Status:** ${customer.status}`,
      `• **Customer ID:** ${customer.customer_id}`,
      `• **Created:** ${formatDate(customer.created_at)}`,
      ``,
      `The customer has been added to the CRM system and is ready for orders and campaigns.`,
    ].join('\n');

    return {
      content: [
        {
          type: 'text',
          text: responseText,
        },
      ],
    };
  }

  private async handleAddOrder(args: any) {
    // Parse and validate arguments
    let orderData;

    try {
      orderData = AddOrderToolSchema.parse(args);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');
        throw new Error(`Invalid order data: ${issues}`);
      }
      throw error;
    }

    // Create order in database
    const order = await dbService.createOrder(orderData);

    // Get updated customer information
    const customer = await dbService.getCustomerById(order.customer_id);

    // Format response
    const responseText = [
      `✅ **Order Recorded Successfully!**`,
      ``,
      `**Order Details:**`,
      `• **Order ID:** ${order.order_id}`,
      `• **Amount:** ${formatCurrency(order.order_amount.toNumber())}`,
      `• **Status:** ${order.order_status}`,
      `• **Date:** ${formatDate(order.created_at)}`,
      ``,
      `**Customer Information:**`,
      `• **Name:** ${order.customers?.name || customer?.name || 'Unknown'}`,
      `• **Email:** ${order.customers?.email || customer?.email || 'Unknown'}`,
      `• **Total Spend:** ${formatCurrency(
        customer?.total_spend?.toNumber() || 0
      )}`,
      `• **Total Visits:** ${customer?.total_visits || 0}`,
      `• **Last Order:** ${formatDate(customer?.last_order_at || null)}`,
      ``,
      `The order has been recorded and customer statistics have been updated automatically.`,
    ].join('\n');

    return {
      content: [
        {
          type: 'text',
          text: responseText,
        },
      ],
    };
  }

  private setupErrorHandling() {
    // Handle server errors
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    // Handle process termination
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down XenCRM MCP Server...');
      await dbService.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.error('🛑 Shutting down XenCRM MCP Server...');
      await dbService.disconnect();
      process.exit(0);
    });
  }

  async start() {
    try {
      // Test database connection
      await dbService.healthCheck();
      console.error('✅ Database connection established');

      // Start the server
      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      console.error('🚀 XenCRM MCP Server is running!');
      console.error('📊 Available tools: add_customer, add_order');
      console.error('💡 Supports natural language inputs for easy interaction');
    } catch (error) {
      console.error('❌ Failed to start XenCRM MCP Server:', error);
      process.exit(1);
    }
  }
}

// Start the server
const server = new XenCRMServer();
server.start().catch((error) => {
  console.error('❌ Server startup failed:', error);
  process.exit(1);
});
