// app.js – Debug version with error catching
require('dotenv').config();

// ----- DEBUG: Catch all unhandled errors -----
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});
// ---------------------------------------------

const express = require('express');
const cors = require('cors');
const { runInvestigation } = require('./agents');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({ message: 'Corruption AI Backend is running!' });
});

app.post('/api/start-investigation', async (req, res) => {
  try {
    const { latitude, longitude, tender_id, timestamp } = req.body;
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required.' });
    }
    const result = await runInvestigation(latitude, longitude, tender_id || null);
    res.json(result);
  } catch (error) {
    console.error('Investigation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// ----- Keep process alive even if something goes wrong -----
server.on('error', (err) => {
  console.error('❌ Server error:', err);
});

// Optional: Keep event loop busy if needed (rare)
// setInterval(() => {}, 1000);