// app.js - Express Server for Corruption AI System
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { runInvestigation } = require('./agents');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS - सभी origins को अनुमति (Development के लिए)
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// Health Check Endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Corruption AI Backend is running!',
    status: 'active',
    timestamp: new Date().toISOString()
  });
});

// Main Investigation API Endpoint
app.post('/api/start-investigation', async (req, res) => {
  try {
    const { latitude, longitude, tender_id, timestamp } = req.body;
    
    // Validation
    if (!latitude || !longitude) {
      return res.status(400).json({ 
        error: 'Latitude and longitude are required.',
        received: { latitude, longitude }
      });
    }

    console.log(`📥 Received: lat=${latitude}, lon=${longitude}, timestamp=${timestamp}`);

    const result = await runInvestigation(latitude, longitude, tender_id || null);
    
    if (result.status === 'error') {
      return res.status(500).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('❌ Investigation error:', error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
});