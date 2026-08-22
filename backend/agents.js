require("dotenv").config();

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

// --------------------------------------------------
// Configuration
// --------------------------------------------------

const REPORT_DIR = path.join(__dirname, "reports");

if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

// --------------------------------------------------
// Reverse Geocoding
// --------------------------------------------------

async function getLocationDetails(latitude, longitude) {
  const url =
    `https://nominatim.openstreetmap.org/reverse` +
    `?format=jsonv2` +
    `&lat=${encodeURIComponent(latitude)}` +
    `&lon=${encodeURIComponent(longitude)}` +
    `&zoom=18` +
    `&addressdetails=1`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "CorruptionAIResearchSystem/1.0 contact@example.com",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Location service failed: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  const address = data.address || {};

  return {
    latitude,
    longitude,

    display_name: data.display_name || null,

    village:
      address.village ||
      address.hamlet ||
      address.suburb ||
      null,

    town:
      address.town ||
      address.city ||
      address.municipality ||
      null,

    district:
      address.county ||
      address.state_district ||
      null,

    state: address.state || null,

    country: address.country || null,

    pincode:
      address.postcode ||
      null,

    raw: data,
  };
}

// --------------------------------------------------
// Map URL
// --------------------------------------------------

function createMapLinks(latitude, longitude) {
  return {
    googleMaps:
      `https://www.google.com/maps?q=${latitude},${longitude}`,

    openStreetMap:
      `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`,
  };
}

// --------------------------------------------------
// Initial report
// --------------------------------------------------

function generatePDF({
  filename,
  title,
  sections,
}) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(REPORT_DIR, filename);

    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: title,
        Author: "Corruption AI Investigation System",
      },
    });

    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .text(title, {
        align: "center",
      });

    doc.moveDown();

    doc
      .fontSize(9)
      .font("Helvetica")
      .text(
        `Generated: ${new Date().toISOString()}`
      );

    doc.moveDown(1);

    for (const section of sections) {
      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text(section.title);

      doc.moveDown(0.4);

      doc
        .fontSize(10)
        .font("Helvetica");

      const content =
        typeof section.content === "string"
          ? section.content
          : JSON.stringify(
              section.content,
              null,
              2
            );

      doc.text(content, {
        align: "left",
      });

      doc.moveDown(1);
    }

    doc.end();

    stream.on("finish", () => {
      resolve(filePath);
    });

    stream.on("error", reject);
  });
}

// --------------------------------------------------
// Basic evidence classification
// --------------------------------------------------

function buildEvidenceRules() {
  return {
    observed:
      "Directly visible or directly measured information.",

    documented:
      "Information obtained from an official/public document.",

    verified:
      "Information confirmed by multiple reliable sources.",

    allegation:
      "A claim that has not yet been independently verified.",

    missing:
      "Information that requires further research or RTI.",
  };
}

// --------------------------------------------------
// Research plan
// --------------------------------------------------

function createResearchPlan(location, tenderId) {
  return [
    {
      priority: 1,
      item: "Identify responsible department",
      status: "pending",
    },
    {
      priority: 2,
      item: "Identify Gram Panchayat / local authority",
      status: "pending",
    },
    {
      priority: 3,
      item: "Find matching tender/work order",
      status: tenderId ? "provided_by_user" : "pending",
    },
    {
      priority: 4,
      item: "Identify contractor",
      status: "pending",
    },
    {
      priority: 5,
      item: "Find sanctioned amount",
      status: "pending",
    },
    {
      priority: 6,
      item: "Find BOQ / work specifications",
      status: "pending",
    },
    {
      priority: 7,
      item: "Find inspection/measurement records",
      status: "pending",
    },
    {
      priority: 8,
      item: "Find payment/bill records",
      status: "pending",
    },
    {
      priority: 9,
      item: "Find material quality certificates",
      status: "pending",
    },
    {
      priority: 10,
      item: "Identify missing records for RTI",
      status: "pending",
    },
  ];
}

// --------------------------------------------------
// Main investigation
// --------------------------------------------------

async function runInvestigation({
  latitude,
  longitude,
  timestamp,
  tenderId,
  photo,
}) {
  console.log(
    `🔎 Investigation started: ${latitude}, ${longitude}`
  );

  const location = await getLocationDetails(
    latitude,
    longitude
  );

  const maps = createMapLinks(
    latitude,
    longitude
  );

  const researchPlan = createResearchPlan(
    location,
    tenderId
  );

  const evidenceRules =
    buildEvidenceRules();

  // IMPORTANT:
  // No fake contractor/tender/budget data.
  // Unknown information remains unknown.

  const initialReport = await generatePDF({
    filename:
      `initial-investigation-${Date.now()}.pdf`,

    title:
      "Initial Field Investigation Report",

    sections: [
      {
        title: "1. Capture Information",
        content: {
          timestamp,
          latitude,
          longitude,
          photoCaptured: Boolean(photo),
        },
      },

      {
        title: "2. Location Information",
        content: location,
      },

      {
        title: "3. Map References",
        content: maps,
      },

      {
        title: "4. User Supplied Tender ID",
        content:
          tenderId ||
          "No tender ID supplied.",
      },

      {
        title: "5. Evidence Classification Rules",
        content: evidenceRules,
      },

      {
        title: "6. Research Plan",
        content: researchPlan,
      },

      {
        title: "7. Important Limitation",
        content:
          "No contractor, budget, tender, supplier, quality or corruption allegation has been treated as established fact at this stage. These facts require documentary verification.",
      },
    ],
  });

  const researchReport = await generatePDF({
    filename:
      `research-plan-${Date.now()}.pdf`,

    title:
      "Government Work Deep Research & Evidence Plan",

    sections: [
      {
        title: "Location",
        content: location,
      },

      {
        title: "Potential Government Records to Research",
        content: [
          "Tender notice",
          "Bid documents",
          "Work order",
          "Agreement",
          "BOQ",
          "Administrative sanction",
          "Technical sanction",
          "Measurement Book / equivalent record",
          "Inspection report",
          "Completion certificate",
          "Payment records",
          "Material test reports",
          "Quality certificates",
          "Supplier information",
          "Audit observations",
        ].join("\n"),
      },

      {
        title: "Supplier / Material Investigation",
        content:
          "Supplier identity, material specifications, test certificates, invoices, warranty/quality claims and procurement records must be independently verified from documentary sources before any allegation is made.",
      },

      {
        title: "RTI Evidence Gaps",
        content:
          researchPlan
            .filter(
              (x) =>
                x.status === "pending"
            )
            .map(
              (x, i) =>
                `${i + 1}. ${x.item}`
            )
            .join("\n"),
      },
    ],
  });

  const finalDraft = await generatePDF({
    filename:
      `evidence-dossier-${Date.now()}.pdf`,

    title:
      "Evidence Dossier - Preliminary",

    sections: [
      {
        title: "Verified Location Data",
        content: location,
      },

      {
        title: "Capture Time",
        content: timestamp,
      },

      {
        title: "GPS Coordinates",
        content:
          `${latitude}, ${longitude}`,
      },

      {
        title: "Google Maps",
        content:
          maps.googleMaps,
      },

      {
        title: "OpenStreetMap",
        content:
          maps.openStreetMap,
      },

      {
        title: "Current Evidence Status",
        content:
          "This dossier contains preliminary field/location evidence. Contractor identity, work value, supplier, bills, quality claims and legal violations must not be stated as established facts until documentary evidence is obtained.",
      },
    ],
  });

  return {
    status: "success",

    capture: {
      timestamp,
      latitude,
      longitude,
      photoReceived: Boolean(photo),
    },

    location,

    maps,

    researchPlan,

    reports: {
      initial: initialReport,
      research: researchReport,
      evidenceDossier: finalDraft,
    },

    driveLinks: [],

    rti: {
      status: "draft_required",
      missingInformation:
        researchPlan
          .filter(
            (x) =>
              x.status === "pending"
          )
          .map((x) => x.item),
    },

    message:
      "Initial investigation completed. Further government-record research is required before making any allegation.",
  };
}

module.exports = {
  runInvestigation,
};