#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { dbService } from './database.js';
import { AddCustomerToolSchema, AddOrderToolSchema, formatCurrency, formatDate, } from './schemas.js';
import { z } from 'zod';
// Server configuration
const SERVER_INFO = {
    name: 'xencrm-mcp-server',
    version: '1.0.0',
};
class XenCRMServer {
    server;
    constructor() {
        this.server = new Server(SERVER_INFO, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
        this.setupErrorHandling();
    }
    setupToolHandlers() {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'add_customer',
                        description: 'Add a new customer to the CRM system. Supports natural language input like "Add a new customer named Rohan with ₹5000 spend and 3 visits."',
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
                        description: 'Record a new order for a customer. Supports natural language input like "Record an order of ₹1200 for user2@example.com."',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                customer_email: {
                                    type: 'string',
                                    format: 'email',
                                    description: 'Email of the customer (use this OR customer_id)',
                                },
                                customer_id: {
                                    type: 'string',
                                    format: 'uuid',
                                    description: 'UUID of the customer (use this OR customer_email)',
                                },
                                order_amount: {
                                    type: 'number',
                                    minimum: 0.01,
                                    description: 'Amount of the order in INR (must be positive)',
                                },
                                order_status: {
                                    type: 'string',
                                    enum: ['COMPLETED', 'PENDING', 'CANCELLED'],
                                    description: 'Status of the order (optional, defaults to COMPLETED)',
                                },
                            },
                            required: ['order_amount'],
                            oneOf: [
                                { required: ['customer_email'] },
                                { required: ['customer_id'] },
                            ],
                        },
                    },
                    {
                        name: 'create_campaign',
                        description: 'Create a new marketing campaign for an existing segment. Use this to launch campaigns to targeted customer groups.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                segment_id: {
                                    type: 'string',
                                    format: 'uuid',
                                    description: 'UUID of the existing segment to target',
                                },
                                name: {
                                    type: 'string',
                                    description: 'Name of the campaign (e.g., "Summer Sale 2024")',
                                },
                                message_template: {
                                    type: 'string',
                                    description: 'Message template for the campaign (supports placeholders like {name}, {total_spend})',
                                },
                                campaign_type: {
                                    type: 'string',
                                    enum: [
                                        'PROMOTIONAL',
                                        'TRANSACTIONAL',
                                        'REMINDER',
                                        'NEWSLETTER',
                                    ],
                                    description: 'Type of campaign (optional, defaults to PROMOTIONAL)',
                                },
                                created_by: {
                                    type: 'string',
                                    description: 'Name or ID of the person creating the campaign',
                                },
                                status: {
                                    type: 'string',
                                    enum: ['ACTIVE', 'INACTIVE', 'DRAFT'],
                                    description: 'Campaign status (optional, defaults to ACTIVE)',
                                },
                            },
                            required: [
                                'segment_id',
                                'name',
                                'message_template',
                                'created_by',
                            ],
                        },
                    },
                    {
                        name: 'list_segments',
                        description: 'List all available customer segments that can be used for campaigns.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                limit: {
                                    type: 'number',
                                    minimum: 1,
                                    maximum: 50,
                                    description: 'Maximum number of segments to return (optional, defaults to 10)',
                                },
                            },
                        },
                    },
                    {
                        name: 'get_campaign_stats',
                        description: 'Get statistics and delivery summary for a specific campaign.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                campaign_id: {
                                    type: 'string',
                                    format: 'uuid',
                                    description: 'UUID of the campaign to get stats for',
                                },
                            },
                            required: ['campaign_id'],
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
                    case 'create_campaign':
                        return await this.handleCreateCampaign(args);
                    case 'list_segments':
                        return await this.handleListSegments(args);
                    case 'get_campaign_stats':
                        return await this.handleGetCampaignStats(args);
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
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
    async handleAddCustomer(args) {
        // Parse and validate arguments
        let customerData;
        try {
            customerData = AddCustomerToolSchema.parse(args);
        }
        catch (error) {
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
            `• **Total Spend:** ${formatCurrency(customer.total_spend?.toNumber() || 0)}`,
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
    async handleAddOrder(args) {
        // Parse and validate arguments
        let orderData;
        try {
            orderData = AddOrderToolSchema.parse(args);
        }
        catch (error) {
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
            `• **Total Spend:** ${formatCurrency(customer?.total_spend?.toNumber() || 0)}`,
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
    async handleCreateCampaign(args) {
        // Validate required fields
        const { segment_id, name, message_template, campaign_type = 'PROMOTIONAL', created_by, status = 'ACTIVE', } = args;
        if (!segment_id || !name || !message_template || !created_by) {
            throw new Error('Missing required fields: segment_id, name, message_template, and created_by are required');
        }
        // Create campaign in database
        const campaign = await dbService.createCampaign({
            segment_id,
            name,
            message_template,
            campaign_type,
            created_by,
            status,
        });
        // Get segment information for the response
        const segment = await dbService.getSegmentById(segment_id);
        // Format response
        const responseText = [
            `🚀 **Campaign Created Successfully!**`,
            ``,
            `**Campaign Details:**`,
            `• **Campaign ID:** ${campaign.campaign_id}`,
            `• **Name:** ${campaign.name}`,
            `• **Type:** ${campaign.campaign_type}`,
            `• **Status:** ${campaign.status}`,
            `• **Created By:** ${campaign.created_by}`,
            `• **Created:** ${formatDate(campaign.created_at)}`,
            ``,
            `**Target Segment:**`,
            `• **Segment:** ${segment?.name || 'Unknown'}`,
            `• **Description:** ${segment?.description || 'No description'}`,
            `• **Target Count:** ${segment?.preview_count || campaign.target_audience_count || 'Unknown'}`,
            ``,
            `**Message Template:**`,
            `"${campaign.message_template}"`,
            ``,
            `The campaign is now ready for execution. Use the campaign stats tool to monitor its performance.`,
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
    async handleListSegments(args) {
        const limit = args?.limit || 10;
        // Get segments from database
        const segments = await dbService.getSegments(limit);
        if (!segments || segments.length === 0) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `📊 **No Segments Found**\n\nThere are currently no customer segments available for campaigns.`,
                    },
                ],
            };
        }
        // Format response
        const segmentsList = segments
            .map((segment, index) => {
            return [
                `**${index + 1}. ${segment.name}**`,
                `   • **ID:** ${segment.segment_id}`,
                `   • **Description:** ${segment.description || 'No description'}`,
                `   • **Target Count:** ${segment.preview_count || 'Unknown'}`,
                `   • **Created:** ${formatDate(segment.created_at)}`,
                `   • **Created By:** ${segment.created_by || 'Unknown'}`,
            ].join('\n');
        })
            .join('\n\n');
        const responseText = [
            `📊 **Available Customer Segments**`,
            ``,
            `Found ${segments.length} segment${segments.length !== 1 ? 's' : ''}:`,
            ``,
            segmentsList,
            ``,
            `Use any segment ID above to create a new campaign targeting that customer group.`,
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
    async handleGetCampaignStats(args) {
        const { campaign_id } = args;
        if (!campaign_id) {
            throw new Error('Campaign ID is required');
        }
        // Get campaign with stats
        const campaign = await dbService.getCampaignWithStats(campaign_id);
        if (!campaign) {
            throw new Error(`Campaign with ID ${campaign_id} not found`);
        }
        // Format response
        const responseText = [
            `📈 **Campaign Statistics**`,
            ``,
            `**Campaign Information:**`,
            `• **Name:** ${campaign.name}`,
            `• **Type:** ${campaign.campaign_type}`,
            `• **Status:** ${campaign.status}`,
            `• **Created:** ${formatDate(campaign.created_at)}`,
            `• **Created By:** ${campaign.created_by}`,
            ``,
            `**Delivery Statistics:**`,
            `• **Total Messages:** ${campaign.campaign_delivery_summary?.total_messages || 0}`,
            `• **Pending:** ${campaign.campaign_delivery_summary?.pending_count || 0}`,
            `• **Sent:** ${campaign.campaign_delivery_summary?.sent_count || 0}`,
            `• **Delivered:** ${campaign.campaign_delivery_summary?.delivered_count || 0}`,
            `• **Failed:** ${campaign.campaign_delivery_summary?.failed_count || 0}`,
            ``,
            `**Performance Metrics:**`,
            `• **Total Sent:** ${campaign.campaign_stats?.total_sent || 0}`,
            `• **Total Delivered:** ${campaign.campaign_stats?.total_delivered || 0}`,
            `• **Total Failed:** ${campaign.campaign_stats?.total_failed || 0}`,
            `• **Delivery Rate:** ${campaign.campaign_stats?.delivery_rate || 0}%`,
            `• **Last Updated:** ${formatDate(campaign.campaign_stats?.last_updated || null)}`,
            ``,
            `**Target Segment:**`,
            `• **Segment:** ${campaign.segments?.name || 'Unknown'}`,
            `• **Target Audience:** ${campaign.target_audience_count ||
                campaign.segments?.preview_count ||
                'Unknown'}`,
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
    setupErrorHandling() {
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
            console.error('📊 Available tools: add_customer, add_order, create_campaign, list_segments, get_campaign_stats');
            console.error('💡 Supports natural language inputs for easy interaction');
        }
        catch (error) {
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
