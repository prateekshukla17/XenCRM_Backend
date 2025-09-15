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

### Frontend - [LinkToRepos](https://github.com/prateekshukla17/XenCRM_Frontend)

- Authenticated via Google OAuth (NextAuth).
- Provides UI to create segments, create campaigns, and view dashboards.
- Communicates with Campaigns DB via APIs (/segments, /campaigns, /dashboard, /campaignStats).

  ![Frontend](./readme_resources/frontend.png)
