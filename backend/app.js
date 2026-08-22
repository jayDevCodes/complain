require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { runInvestigation } = require("./agents");

const app = express();

const PORT = Number(process.env.PORT || 5000);
const HOST = "0.0.0.0";

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "20mb" }));

// --------------------------------------------------
// Health check
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Corruption AI Backend",
    port: PORT,
    time: new Date().toISOString(),
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "corruption-ai-backend",
    time: new Date().toISOString(),
  });
});

// --------------------------------------------------
// Investigation
// --------------------------------------------------

app.post("/api/start-investigation", async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      timestamp,
      tender_id,
      photo,
    } = req.body;

    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number"
    ) {
      return res.status(400).json({
        status: "error",
        error: "Valid latitude and longitude are required.",
      });
    }

    if (latitude < -90 || latitude > 90) {
      return res.status(400).json({
        status: "error",
        error: "Invalid latitude.",
      });
    }

    if (longitude < -180 || longitude > 180) {
      return res.status(400).json({
        status: "error",
        error: "Invalid longitude.",
      });
    }

    console.log("======================================");
    console.log("NEW INVESTIGATION");
    console.log("Latitude :", latitude);
    console.log("Longitude:", longitude);
    console.log("Timestamp:", timestamp);
    console.log("Tender   :", tender_id || "Not provided");
    console.log("Photo    :", photo ? "Received" : "Not received");
    console.log("======================================");

    const result = await runInvestigation({
      latitude,
      longitude,
      timestamp: timestamp || new Date().toISOString(),
      tenderId: tender_id || null,
      photo: photo || null,
    });

    return res.json(result);
  } catch (error) {
    console.error("❌ Investigation error:", error);

    return res.status(500).json({
      status: "error",
      error: error.message || "Internal server error",
    });
  }
});

// --------------------------------------------------
// 404
// --------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    status: "error",
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// --------------------------------------------------
// Start server
// --------------------------------------------------

const server = app.listen(PORT, HOST, () => {
  console.log("");
  console.log("======================================");
  console.log("🚀 CORRUPTION AI BACKEND");
  console.log("======================================");
  console.log(`Local:  http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log("======================================");
});

server.on("error", (error) => {
  console.error("❌ Server error:", error);

  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
  }
});

process.on("SIGINT", () => {
  console.log("\nStopping server...");
  server.close(() => process.exit(0));
});