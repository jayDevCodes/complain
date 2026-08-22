// app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { runInvestigation } = require('./agents');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Corruption AI Backend is running!' });
});

// Main API endpoint
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});