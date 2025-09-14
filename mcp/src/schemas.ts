import { z } from 'zod';

// Customer schemas
export const CreateCustomerSchema = z.object({
  name: z.string().min(1, 'Customer name is required').max(255, 'Name too long'),
  email: z.string().email('Invalid email format').max(255, 'Email too long'),
  phone: z.string().max(20, 'Phone too long').optional(),
  total_spend: z.number().min(0, 'Total spend cannot be negative').optional(),
  total_visits: z.number().int().min(0, 'Total visits cannot be negative').optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const UpdateCustomerSchema = z.object({
  customer_id: z.string().uuid('Invalid customer ID format'),
  name: z.string().min(1, 'Customer name is required').max(255, 'Name too long').optional(),
  email: z.string().email('Invalid email format').max(255, 'Email too long').optional(),
  phone: z.string().max(20, 'Phone too long').optional(),
  total_spend: z.number().min(0, 'Total spend cannot be negative').optional(),
  total_visits: z.number().int().min(0, 'Total visits cannot be negative').optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const SearchCustomersSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  limit: z.number().int().min(1).max(100).optional().default(10),
});

export const GetCustomerSchema = z.object({
  email: z.string().email('Invalid email format').optional(),
  customer_id: z.string().uuid('Invalid customer ID format').optional(),
}).refine((data) => data.email || data.customer_id, {
  message: 'Either email or customer_id is required',
});

// Order schemas
export const CreateOrderSchema = z.object({
  customer_email: z.string().email('Invalid email format').optional(),
  customer_id: z.string().uuid('Invalid customer ID format').optional(),
  order_amount: z.number().positive('Order amount must be positive'),
  order_status: z.enum(['COMPLETED', 'PENDING', 'CANCELLED']).optional().default('COMPLETED'),
}).refine((data) => data.customer_email || data.customer_id, {
  message: 'Either customer_email or customer_id is required',
});

export const GetOrdersSchema = z.object({
  customer_id: z.string().uuid('Invalid customer ID format').optional(),
  customer_email: z.string().email('Invalid email format').optional(),
  limit: z.number().int().min(1).max(100).optional().default(10),
});

export const GetAnalyticsSchema = z.object({
  customer_id: z.string().uuid('Invalid customer ID format').optional(),
});

// Tool input schemas for MCP
export const AddCustomerToolSchema = z.object({
  name: z.string().describe('Full name of the customer'),
  email: z.string().email().describe('Email address of the customer'),
  phone: z.string().optional().describe('Phone number of the customer (optional)'),
  total_spend: z.number().min(0).optional().describe('Initial total spend amount (optional)'),
  total_visits: z.number().int().min(0).optional().describe('Initial total visits count (optional)'),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().describe('Customer status (optional, defaults to ACTIVE)'),
});

export const AddOrderToolSchema = z.object({
  customer_email: z.string().email().optional().describe('Email of the customer (use this OR customer_id)'),
  customer_id: z.string().uuid().optional().describe('ID of the customer (use this OR customer_email)'),
  order_amount: z.number().positive().describe('Amount of the order (must be positive)'),
  order_status: z.enum(['COMPLETED', 'PENDING', 'CANCELLED']).optional().describe('Status of the order (optional, defaults to COMPLETED)'),
}).refine((data) => data.customer_email || data.customer_id, {
  message: 'Either customer_email or customer_id must be provided',
});

// Response types
export type CustomerResponse = {
  customer_id: string;
  name: string;
  email: string;
  phone: string | null;
  total_spend: number | null;
  total_visits: number | null;
  last_order_at: Date | null;
  status: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  orders?: OrderResponse[];
};

export type OrderResponse = {
  order_id: string;
  customer_id: string;
  order_amount: number;
  order_status: string | null;
  created_at: Date | null;
  customers?: {
    name: string;
    email: string;
  };
};

export type AnalyticsResponse = {
  customer?: {
    id: string;
    name: string;
    email: string;
    total_spend: number;
    total_visits: number;
  };
  analytics: {
    total_customers?: number;
    total_orders: number;
    total_revenue?: number;
    total_spent?: number;
    average_order_value: number;
    status?: string;
    last_order_at?: Date;
  };
};

// Utility function to format currency
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(amount);
};

// Utility function to format dates
export const formatDate = (date: Date | null): string => {
  if (!date) return 'Never';
  return new Intl.DateTimeFormat('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

// Utility function to validate and parse natural language inputs
export const parseCustomerFromText = (text: string): Partial<z.infer<typeof AddCustomerToolSchema>> => {
  const result: Partial<z.infer<typeof AddCustomerToolSchema>> = {};
  
  // Extract name (look for "named" or "called")
  const nameMatch = text.match(/(?:named|called)\s+(\w+(?:\s+\w+)*)/i);
  if (nameMatch) {
    result.name = nameMatch[1].trim();
  }
  
  // Extract email
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) {
    result.email = emailMatch[0];
  }
  
  // Extract spend amount (look for ₹ or rupees)
  const spendMatch = text.match(/₹\s*(\d+(?:,\d+)*(?:\.\d+)?)|(\d+(?:,\d+)*(?:\.\d+)?)\s*rupees?/i);
  if (spendMatch) {
    const amount = spendMatch[1] || spendMatch[2];
    result.total_spend = parseFloat(amount.replace(/,/g, ''));
  }
  
  // Extract visits count
  const visitsMatch = text.match(/(\d+)\s+visits?/i);
  if (visitsMatch) {
    result.total_visits = parseInt(visitsMatch[1]);
  }
  
  return result;
};

export const parseOrderFromText = (text: string): Partial<z.infer<typeof AddOrderToolSchema>> => {
  const result: Partial<z.infer<typeof AddOrderToolSchema>> = {};
  
  // Extract email
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) {
    result.customer_email = emailMatch[0];
  }
  
  // Extract order amount (look for ₹ or rupees)
  const amountMatch = text.match(/₹\s*(\d+(?:,\d+)*(?:\.\d+)?)|(\d+(?:,\d+)*(?:\.\d+)?)\s*rupees?/i);
  if (amountMatch) {
    const amount = amountMatch[1] || amountMatch[2];
    result.order_amount = parseFloat(amount.replace(/,/g, ''));
  }
  
  // Extract order status if mentioned
  if (text.match(/pending/i)) {
    result.order_status = 'PENDING';
  } else if (text.match(/cancelled/i)) {
    result.order_status = 'CANCELLED';
  } else {
    result.order_status = 'COMPLETED';
  }
  
  return result;
};