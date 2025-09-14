import { PrismaClient as CustomerPrismaClient } from '../../node_modules/.prisma/customer-client/index.js';
import { PrismaClient as CampaignPrismaClient } from '../../node_modules/.prisma/campaign-client/index.js';
import { error } from 'console';

// Initialize Prisma clients
const customerPrisma = new CustomerPrismaClient();
const campaignPrisma = new CampaignPrismaClient();

// Database service class
export class DatabaseService {
  private customerDB: CustomerPrismaClient;
  private campaignDB: CampaignPrismaClient;

  constructor() {
    this.customerDB = customerPrisma;
    this.campaignDB = campaignPrisma;
  }

  // Customer operations
  async createCustomer(data: {
    name: string;
    email: string;
    phone?: string;
    total_spend?: number;
    total_visits?: number;
    status?: string;
  }) {
    try {
      const customer = await this.customerDB.customers.create({
        data: {
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          total_spend: data.total_spend || 0.0,
          total_visits: data.total_visits || 0,
          status: data.status || 'ACTIVE',
        },
      });
      return customer;
    } catch (error: any) {
      throw new Error(`Failed to create customer: ${error.message}`);
    }
  }

  async getCustomerByEmail(email: string) {
    try {
      const customer = await this.customerDB.customers.findUnique({
        where: { email },
        include: {
          orders: {
            orderBy: { created_at: 'desc' },
            take: 10, // Get last 10 orders
          },
        },
      });
      return customer;
    } catch (error: any) {
      throw new Error(`Failed to get customer: ${error.message}`);
    }
  }

  async getCustomerById(customerId: string) {
    try {
      const customer = await this.customerDB.customers.findUnique({
        where: { customer_id: customerId },
        include: {
          orders: {
            orderBy: { created_at: 'desc' },
            take: 10,
          },
        },
      });
      return customer;
    } catch (error: any) {
      throw new Error(`Failed to get customer: ${error.message}`);
    }
  }

  async updateCustomer(
    customerId: string,
    data: {
      name?: string;
      email?: string;
      phone?: string;
      total_spend?: number;
      total_visits?: number;
      status?: string;
    }
  ) {
    try {
      const customer = await this.customerDB.customers.update({
        where: { customer_id: customerId },
        data: {
          ...data,
          updated_at: new Date(),
        },
      });
      return customer;
    } catch (error: any) {
      throw new Error(`Failed to update customer: ${error.message}`);
    }
  }

  async searchCustomers(query: {
    name?: string;
    email?: string;
    status?: string;
    limit?: number;
  }) {
    try {
      const whereClause: any = {};

      if (query.name) {
        whereClause.name = {
          contains: query.name,
          mode: 'insensitive',
        };
      }

      if (query.email) {
        whereClause.email = {
          contains: query.email,
          mode: 'insensitive',
        };
      }

      if (query.status) {
        whereClause.status = query.status;
      }

      const customers = await this.customerDB.customers.findMany({
        where: whereClause,
        take: query.limit || 10,
        orderBy: { created_at: 'desc' },
        include: {
          orders: {
            take: 5,
            orderBy: { created_at: 'desc' },
          },
        },
      });

      return customers;
    } catch (error: any) {
      throw new Error(`Failed to search customers: ${error.message}`);
    }
  }

  // Order operations
  async createOrder(data: {
    customer_email?: string;
    customer_id?: string;
    order_amount: number;
    order_status?: string;
  }) {
    try {
      let customerId = data.customer_id;

      // If email provided instead of ID, find customer by email
      if (data.customer_email && !customerId) {
        const customer = await this.getCustomerByEmail(data.customer_email);
        if (!customer) {
          throw new Error(
            `Customer with email ${data.customer_email} not found`
          );
        }
        customerId = customer.customer_id;
      }

      if (!customerId) {
        throw new Error('Customer ID or email is required');
      }

      // Create the order
      const order = await this.customerDB.orders.create({
        data: {
          customer_id: customerId,
          order_amount: data.order_amount,
          order_status: data.order_status || 'COMPLETED',
        },
        include: {
          customers: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      // Update customer's total spend and visit count
      await this.updateCustomerStats(customerId, data.order_amount);

      // Create outbox event for the new order
      await this.createOutboxEvent('order_created', order.order_id, {
        order_id: order.order_id,
        customer_id: customerId,
        order_amount: data.order_amount,
        order_status: data.order_status || 'COMPLETED',
        created_at: new Date(),
      });

      return order;
    } catch (error: any) {
      throw new Error(`Failed to create order: ${error.message}`);
    }
  }

  async getOrdersByCustomer(customerId: string, limit: number = 10) {
    try {
      const orders = await this.customerDB.orders.findMany({
        where: { customer_id: customerId },
        orderBy: { created_at: 'desc' },
        take: limit,
        include: {
          customers: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });
      return orders;
    } catch (error: any) {
      throw new Error(`Failed to get orders: ${error.message}`);
    }
  }

  async getRecentOrders(limit: number = 10) {
    try {
      const orders = await this.customerDB.orders.findMany({
        orderBy: { created_at: 'desc' },
        take: limit,
        include: {
          customers: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });
      return orders;
    } catch (error: any) {
      throw new Error(`Failed to get recent orders: ${error.message}`);
    }
  }

  // Helper method to update customer statistics
  private async updateCustomerStats(customerId: string, orderAmount: number) {
    try {
      const customer = await this.customerDB.customers.findUnique({
        where: { customer_id: customerId },
      });

      if (!customer) {
        throw new Error('Customer not found');
      }

      const newTotalSpend =
        (customer.total_spend?.toNumber() || 0) + orderAmount;
      const newTotalVisits = (customer.total_visits || 0) + 1;

      await this.customerDB.customers.update({
        where: { customer_id: customerId },
        data: {
          total_spend: newTotalSpend,
          total_visits: newTotalVisits,
          last_order_at: new Date(),
          updated_at: new Date(),
        },
      });
    } catch (error: any) {
      console.error('Failed to update customer stats:', error);
      // Don't throw error here to avoid breaking order creation
    }
  }

  // Create outbox event for downstream processing
  private async createOutboxEvent(
    eventType: string,
    entityId: string,
    payload: any
  ) {
    try {
      await this.customerDB.outbox_events.create({
        data: {
          event_type: eventType,
          entity_id: entityId,
          payload: payload,
          published: false,
        },
      });
    } catch (error: any) {
      console.error('Failed to create outbox event:', error);
      // Don't throw error to avoid breaking main operation
    }
  }

  // Get customer analytics
  async getCustomerAnalytics(customerId?: string) {
    try {
      if (customerId) {
        // Get analytics for specific customer
        const customer = await this.customerDB.customers.findUnique({
          where: { customer_id: customerId },
          include: {
            orders: {
              select: {
                order_amount: true,
                order_status: true,
                created_at: true,
              },
            },
          },
        });

        if (!customer) {
          throw new Error('Customer not found');
        }

        const totalOrders = customer.orders.length;
        const totalSpent = customer.orders.reduce(
          (sum, order) => sum + order.order_amount.toNumber(),
          0
        );
        const averageOrderValue =
          totalOrders > 0 ? totalSpent / totalOrders : 0;

        return {
          customer: {
            id: customer.customer_id,
            name: customer.name,
            email: customer.email,
            total_spend: customer.total_spend?.toNumber() || 0,
            total_visits: customer.total_visits || 0,
          },
          analytics: {
            total_orders: totalOrders,
            total_spent: totalSpent,
            average_order_value: averageOrderValue,
            status: customer.status,
            last_order_at: customer.last_order_at,
          },
        };
      } else {
        // Get overall analytics
        const totalCustomers = await this.customerDB.customers.count();
        const totalOrders = await this.customerDB.orders.count();

        const orderStats = await this.customerDB.orders.aggregate({
          _sum: {
            order_amount: true,
          },
          _avg: {
            order_amount: true,
          },
        });

        return {
          analytics: {
            total_customers: totalCustomers,
            total_orders: totalOrders,
            total_revenue: orderStats._sum.order_amount?.toNumber() || 0,
            average_order_value: orderStats._avg.order_amount?.toNumber() || 0,
          },
        };
      }
    } catch (error: any) {
      throw new Error(`Failed to get analytics: ${error.message}`);
    }
  }

  async createCampaign(data: {
    segment_id: string;
    name: string;
    message_template: string;
    campaign_type?: string;
    created_by: string;
    status?: string;
  }) {
    try {
      const segement = await this.campaignDB.segments.findUnique({
        where: { segment_id: data.segment_id },
        select: { preview_count: true, name: true },
      });

      if (!segement) {
        throw new Error(`Segment with ID ${data.segment_id} not found`);
      }

      const campaign = await this.campaignDB.campaigns.create({
        data: {
          segment_id: data.segment_id,
          name: data.name,
          message_template: data.message_template,
          campaign_type: data.campaign_type || 'PROMOTIONAL',
          target_audience_count: segement.preview_count || 0,
          created_by: data.created_by,
          status: data.status || 'Active',
        },
        include: {
          segments: {
            select: {
              name: true,
              description: true,
              preview_count: true,
            },
          },
        },
      });

      return campaign;
    } catch (error: any) {
      throw new Error(`Campaign not Created: ${error.message}`);
    }
  }

  async getCampaignWithStats(campaignId: string) {
    try {
      const campaign = await this.campaignDB.campaigns.findUnique({
        where: { campaign_id: campaignId },
        include: {
          campaign_stats: true,
          campaign_delivery_summary: true,
          segments: {
            select: {
              name: true,
              description: true,
              preview_count: true,
            },
          },
        },
      });
      return campaign;
    } catch (error: any) {
      throw new Error(`Failed to get campaign Stats ${error.message}`);
    }
  }
  async getSegments(limit: number = 10) {
    try {
      const segments = await this.campaignDB.segments.findMany({
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          segment_id: true,
          name: true,
          description: true,
          preview_count: true,
          created_by: true,
          created_at: true,
          updated_at: true,
          _count: {
            select: {
              campaigns: true,
            },
          },
        },
      });
      return segments;
    } catch (error: any) {
      throw new Error(`Failed to get segments: ${error.message}`);
    }
  }

  async getSegmentById(segmentId: string) {
    try {
      const segment = await this.campaignDB.segments.findUnique({
        where: { segment_id: segmentId },
        include: {
          _count: {
            select: {
              campaigns: true,
            },
          },
        },
      });
      return segment;
    } catch (error: any) {
      throw new Error(`Failed to get segment: ${error.message}`);
    }
  }

  async getCampaignsBySegment(segmentId: string, limit: number = 10) {
    try {
      const campaigns = await this.campaignDB.campaigns.findMany({
        where: { segment_id: segmentId },
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          campaign_stats: true,
          campaign_delivery_summary: true,
        },
      });
      return campaigns;
    } catch (error: any) {
      throw new Error(`Failed to get campaigns for segment: ${error.message}`);
    }
  }

  async getCampaigns(limit: number = 10, status?: string) {
    try {
      const whereClause: any = {};

      if (status) {
        whereClause.status = status;
      }

      const campaigns = await this.campaignDB.campaigns.findMany({
        where: whereClause,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          segments: {
            select: {
              name: true,
              description: true,
              preview_count: true,
            },
          },
          campaign_stats: {
            select: {
              total_sent: true,
              total_delivered: true,
              total_failed: true,
              delivery_rate: true,
              last_updated: true,
            },
          },
          campaign_delivery_summary: {
            select: {
              total_messages: true,
              pending_count: true,
              sent_count: true,
              delivered_count: true,
              failed_count: true,
            },
          },
        },
      });
      return campaigns;
    } catch (error: any) {
      throw new Error(`Failed to get campaigns: ${error.message}`);
    }
  }

  async getRecentCampaigns(limit: number = 10) {
    try {
      const campaigns = await this.campaignDB.campaigns.findMany({
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          segments: {
            select: {
              name: true,
              description: true,
            },
          },
          campaign_stats: true,
          campaign_delivery_summary: true,
        },
      });
      return campaigns;
    } catch (error: any) {
      throw new Error(`Failed to get recent campaigns: ${error.message}`);
    }
  }
  async updateCampaignStatus(campaignId: string, status: string) {
    try {
      const campaign = await this.campaignDB.campaigns.update({
        where: { campaign_id: campaignId },
        data: { status },
      });
      return campaign;
    } catch (error: any) {
      throw new Error(`Failed to update campaign status: ${error.message}`);
    }
  }

  // Get campaign analytics
  async getCampaignAnalytics(campaignId?: string) {
    try {
      if (campaignId) {
        // Get analytics for specific campaign
        const campaign = await this.getCampaignWithStats(campaignId);

        if (!campaign) {
          throw new Error('Campaign not found');
        }

        return {
          campaign: {
            id: campaign.campaign_id,
            name: campaign.name,
            type: campaign.campaign_type,
            status: campaign.status,
            created_at: campaign.created_at,
            target_audience_count: campaign.target_audience_count,
          },
          stats: campaign.campaign_stats,
          delivery: campaign.campaign_delivery_summary,
          segment: campaign.segments,
        };
      } else {
        // Get overall campaign analytics
        const totalCampaigns = await this.campaignDB.campaigns.count();
        const activeCampaigns = await this.campaignDB.campaigns.count({
          where: { status: 'ACTIVE' },
        });

        const deliveryStats =
          await this.campaignDB.campaign_delivery_summary.aggregate({
            _sum: {
              total_messages: true,
              sent_count: true,
              delivered_count: true,
              failed_count: true,
            },
          });

        return {
          analytics: {
            total_campaigns: totalCampaigns,
            active_campaigns: activeCampaigns,
            total_messages: deliveryStats._sum.total_messages || 0,
            total_sent: deliveryStats._sum.sent_count || 0,
            total_delivered: deliveryStats._sum.delivered_count || 0,
            total_failed: deliveryStats._sum.failed_count || 0,
          },
        };
      }
    } catch (error: any) {
      throw new Error(`Failed to get campaign analytics: ${error.message}`);
    }
  }

  // Health check
  async healthCheck() {
    try {
      await this.customerDB.$queryRaw`SELECT 1`;
      await this.campaignDB.$queryRaw`SELECT 1`;
      return { status: 'healthy', timestamp: new Date() };
    } catch (error: any) {
      throw new Error(`Database health check failed: ${error.message}`);
    }
  }

  // Close database connections
  async disconnect() {
    await this.customerDB.$disconnect();
    await this.campaignDB.$disconnect();
  }
}

// Export singleton instance
export const dbService = new DatabaseService();
