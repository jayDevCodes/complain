// agents.js
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const NodeGeocoder = require('node-geocoder');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// ---------- Gemini AI Setup ----------
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

async function callGemini(prompt) {
  try {
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (e) {
    console.error('Gemini error:', e);
    return 'ERROR: ' + e.message;
  }
}

// ---------- Geocoding (OpenStreetMap – Free) ----------
const geocoder = NodeGeocoder({
  provider: 'openstreetmap',
  language: 'en',
});

async function getLocationDetails(lat, lon) {
  try {
    const res = await geocoder.reverse({ lat, lon });
    if (res && res.length) {
      const data = res[0];
      return {
        latitude: lat,
        longitude: lon,
        display_name: data.formattedAddress || data.address,
        city: data.city || data.town || data.village,
        district: data.stateDistrict || data.district,
        state: data.state,
        pincode: data.postalCode,
      };
    }
  } catch (e) {
    console.error('Geocoding error:', e);
  }
  return { latitude: lat, longitude: lon, error: 'Location not found' };
}

// ---------- Tender Search (Mock – Replace with Bidrove MCP API) ----------
async function searchTenders(location) {
  // Mock data – in real, call https://api.bidrove.in/tenders
  return [
    {
      id: 'GEM/2024/B/001',
      title: 'Road Construction',
      department: 'PWD',
      budget: '₹50,00,000',
      contractor: 'ABC Constructions',
      status: 'Active',
    },
    {
      id: 'GEM/2024/B/002',
      title: 'School Building',
      department: 'Education',
      budget: '₹25,00,000',
      contractor: 'XYZ Builders',
      status: 'Completed',
    },
  ];
}

// ---------- PDF Generation (PDFKit) ----------
function generatePDFReport(filename, title, sections, evidence = []) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const writeStream = fs.createWriteStream(filename);
    doc.pipe(writeStream);

    // Title
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#1a237e').text(title, { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).font('Helvetica').fillColor('black').text(`Generated: ${new Date().toLocaleDateString()}`);
    doc.moveDown();

    // Sections
    sections.forEach(sec => {
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a237e').text(sec.heading);
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica').fillColor('black');
      sec.content.forEach(para => {
        doc.text(para, { align: 'justify' });
        doc.moveDown(0.3);
      });
      doc.moveDown();
    });

    // Evidence table
    if (evidence.length) {
      doc.addPage();
      doc.fontSize(14).font('Helvetica-Bold').text('Evidence Attached');
      doc.moveDown();
      const tableTop = doc.y;
      // Simple table using text
      doc.fontSize(8).font('Helvetica-Bold');
      doc.text('#', 50, tableTop);
      doc.text('Description', 80, tableTop);
      doc.text('Source', 300, tableTop);
      doc.moveDown();
      evidence.forEach((ev, i) => {
        doc.fontSize(8).font('Helvetica');
        doc.text(`${i+1}`, 50, doc.y);
        doc.text(ev.desc || '', 80, doc.y - 5);
        doc.text(ev.src || '', 300, doc.y - 5);
        doc.moveDown(0.5);
      });
    }

    doc.end();
    writeStream.on('finish', () => resolve(filename));
    writeStream.on('error', reject);
  });
}

// ---------- Google Drive Upload ----------
async function uploadToDrive(filePath, fileName) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: 'credentials.json',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    const drive = google.drive({ version: 'v3', auth });
    const fileMeta = {
      name: fileName || path.basename(filePath),
      parents: [], // specify folder ID if needed
    };
    const media = {
      mimeType: 'application/pdf',
      body: fs.createReadStream(filePath),
    };
    const response = await drive.files.create({
      resource: fileMeta,
      media: media,
      fields: 'id',
    });
    const fileId = response.data.id;
    return `https://drive.google.com/file/d/${fileId}/view`;
  } catch (e) {
    console.error('Drive upload skipped:', e.message);
    return `LOCAL_FILE: ${filePath}`;
  }
}

// ---------- RTI Draft ----------
function generateRTIDraft(subject, department, questions) {
  let draft = `To, The PIO,\n${department}\n\nSubject: ${subject}\n\n`;
  questions.forEach((q, i) => {
    draft += `${i+1}. ${q}\n`;
  });
  draft += `\nYours sincerely,\nCitizen\nDate: ${new Date().toLocaleDateString()}`;
  return draft;
}

// ---------- Main Investigation Function ----------
async function runInvestigation(lat, lon, tenderId = null) {
  console.log(`🚀 Starting investigation at (${lat}, ${lon})`);

  // 1. Location
  const location = await getLocationDetails(lat, lon);
  const city = location.city || location.district || 'India';

  // 2. Tenders
  const tenders = await searchTenders(city);

  // 3. AI Analysis
  const prompt = `Analyze this location: ${JSON.stringify(location)} and tenders: ${JSON.stringify(tenders)}. List fraud risks and give summary.`;
  const aiSummary = await callGemini(prompt);

  // 4. Generate PDFs
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reports = [];
  const driveLinks = [];

  // Report 1 – Initial
  const r1 = `report_1_${timestamp}.pdf`;
  await generatePDFReport(r1, 'Initial Investigation Report', [
    { heading: 'Location Details', content: [JSON.stringify(location, null, 2)] },
    { heading: 'Tenders Found', content: [JSON.stringify(tenders, null, 2)] },
    { heading: 'AI Analysis', content: [aiSummary] },
  ]);
  reports.push(r1);
  driveLinks.push(await uploadToDrive(r1));

  // Report 2 – Supplier Fraud (mock)
  const r2 = `report_2_${timestamp}.pdf`;
  await generatePDFReport(r2, 'Supplier Fraud Analysis', [
    { heading: 'Contractor Details', content: ['Check quality claims and past complaints.'] },
    { heading: 'Recommendations', content: ['Cross-check bills with actual materials.'] },
  ]);
  reports.push(r2);
  driveLinks.push(await uploadToDrive(r2));

  // RTI Draft
  const rti = generateRTIDraft(
    'Tender Corruption Investigation',
    'PWD Department',
    ['Provide all tender documents', 'List of contractors and their bids', 'Quality certificates of materials']
  );

  // Report 3 – Final Complaint (summary)
  const r3 = `report_3_final_${timestamp}.pdf`;
  await generatePDFReport(r3, 'Final Complaint with Evidence', [
    { heading: 'Summary of Findings', content: [aiSummary.substring(0, 500)] },
    { heading: 'RTI Draft', content: [rti] },
  ]);
  reports.push(r3);
  driveLinks.push(await uploadToDrive(r3));

  return {
    status: 'success',
    location,
    tenders,
    aiSummary,
    driveLinks,
    rtiDraft: rti,
    localFiles: reports,
  };
}

module.exports = { runInvestigation };