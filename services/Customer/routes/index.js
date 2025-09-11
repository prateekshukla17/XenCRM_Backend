const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();

app.use(express.json());
app.use(cors());

app.post('/api/customers', customers);
app.post('/api/orders', orders);
