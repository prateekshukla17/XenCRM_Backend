const {
  PrismaClient: CustomerPrismaClient,
} = require('../node_modules/.prisma/customer-client');
const {
  PrismaClient: CampaignPrismaClient,
} = require('../node_modules/.prisma/campaign-client');
const {
  PrismaClient: DeliveryPrismaClient,
} = require('../node_modules/.prisma/delivery-client');

const customerPrisma = new CustomerPrismaClient();
const campaignPrisma = new CampaignPrismaClient();
const deliveryPrisma = new DeliveryPrismaClient();

module.exports = {
  customerDB: {
    prisma: customerPrisma,
    customers: customerPrisma.customers,
    orders: customerPrisma.orders,
    outboxEvents: customerPrisma.outbox_events,
  },

  campaignDB: {
    prisma: campaignPrisma,
    customerMV: campaignPrisma.customerMV,
    segment: campaignPrisma.segment,
    campaign: campaignPrisma.campaign,
    campaignStats: campaignPrisma.campaignStats,
  },

  deliveryDB: {
    prisma: deliveryPrisma,
    communicationLog: deliveryPrisma.communicationLog,
    deliveryReceipt: deliveryPrisma.deliveryReceipt,
  },
};
