// agents.js – Complete AI Logic for Corruption Investigation System
require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const NodeGeocoder = require('node-geocoder');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// ---------- 1. Gemini AI Setup ----------
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

async function callGemini(prompt) {
  try {
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error('❌ Gemini API error:', error.message);
    return 'ERROR: ' + error.message;
  }
}

// ---------- 2. Geocoding (OpenStreetMap – Free) ----------
const geocoder = NodeGeocoder({
  provider: 'openstreetmap',
  language: 'en',
});

async function getLocationDetails(lat, lon) {
  try {
    const res = await geocoder.reverse({ lat, lon });
    if (res && res.length > 0) {
      const data = res[0];
      return {
        latitude: lat,
        longitude: lon,
        display_name: data.formattedAddress || data.address || 'Unknown',
        city: data.city || data.town || data.village || null,
        district: data.stateDistrict || data.district || null,
        state: data.state || null,
        pincode: data.postalCode || null,
        country: data.country || 'India',
      };
    }
    return { latitude: lat, longitude: lon, error: 'Location not found' };
  } catch (error) {
    console.error('❌ Geocoding error:', error.message);
    return { latitude: lat, longitude: lon, error: error.message };
  }
}

// ---------- 3. Tender Search (Mock – Real API से Replace करें) ----------
async function searchTenders(location) {
  // Mock data – real के लिए Bidrove MCP API integrate करें
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

// ---------- 4. PDF Generation (PDFKit) ----------
function generatePDFReport(filename, title, sections, evidence = []) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const writeStream = fs.createWriteStream(filename);
      doc.pipe(writeStream);

      // Title
      doc.fontSize(20)
        .font('Helvetica-Bold')
        .fillColor('#1a237e')
        .text(title, { align: 'center' });
      doc.moveDown();

      // Timestamp
      doc.fontSize(10)
        .font('Helvetica')
        .fillColor('black')
        .text(`Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`);
      doc.moveDown();

      // Sections
      sections.forEach((sec) => {
        doc.fontSize(14)
          .font('Helvetica-Bold')
          .fillColor('#1a237e')
          .text(sec.heading);
        doc.moveDown(0.5);
        doc.fontSize(10)
          .font('Helvetica')
          .fillColor('black');
        (sec.content || []).forEach((para) => {
          doc.text(String(para), { align: 'justify' });
          doc.moveDown(0.3);
        });
        doc.moveDown();
      });

      // Evidence table
      if (evidence && evidence.length > 0) {
        doc.addPage();
        doc.fontSize(14)
          .font('Helvetica-Bold')
          .text('Evidence Attached');
        doc.moveDown();
        const tableTop = doc.y;
        doc.fontSize(8).font('Helvetica-Bold');
        doc.text('#', 50, tableTop);
        doc.text('Description', 80, tableTop);
        doc.text('Source', 300, tableTop);
        doc.moveDown();
        let currentY = doc.y;
        evidence.forEach((ev, i) => {
          doc.fontSize(8).font('Helvetica');
          doc.text(`${i + 1}`, 50, currentY);
          const desc = (ev.desc || '').substring(0, 50);
          doc.text(desc, 80, currentY);
          const src = (ev.src || '').substring(0, 40);
          doc.text(src, 300, currentY);
          currentY += 20;
          doc.moveDown(0.5);
        });
      }

      doc.end();
      writeStream.on('finish', () => resolve(filename));
      writeStream.on('error', (err) => reject(err));
    } catch (error) {
      reject(error);
    }
  });
}

// ---------- 5. Google Drive Upload (Optional) ----------
async function uploadToDrive(filePath, fileName) {
  try {
    if (!fs.existsSync('credentials.json')) {
      console.warn('⚠️ credentials.json not found – skipping Drive upload');
      return `LOCAL_FILE: ${filePath}`;
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: 'credentials.json',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    const drive = google.drive({ version: 'v3', auth });
    const fileMeta = {
      name: fileName || path.basename(filePath),
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
  } catch (error) {
    console.warn('⚠️ Google Drive upload failed:', error.message);
    return `LOCAL_FILE: ${filePath}`;
  }
}

// ---------- 6. RTI Draft Generation ----------
function generateRTIDraft(subject, department, questions) {
  let draft = `To,\nThe Public Information Officer,\n${department}\nGovernment of India\n\n`;
  draft += `Subject: ${subject}\n\n`;
  draft += `Respected Sir/Madam,\n\n`;
  draft += `I, a citizen of India, request the following information under the Right to Information Act, 2005:\n\n`;
  questions.forEach((q, i) => {
    draft += `${i + 1}. ${q}\n`;
  });
  draft += `\nPlease provide the above information within the stipulated 30 days.\n\n`;
  draft += `Yours sincerely,\nCitizen\n`;
  draft += `Date: ${new Date().toLocaleDateString('en-IN')}`;
  return draft;
}

// ---------- 7. Main Investigation Function ----------
async function runInvestigation(lat, lon, tenderId = null) {
  console.log(`🚀 Starting investigation at (${lat}, ${lon})`);

  try {
    // 1. Get location details
    const location = await getLocationDetails(lat, lon);
    const city = location.city || location.district || 'India';

    // 2. Fetch tenders
    const tenders = await searchTenders(city);

    // 3. AI analysis
    const prompt = `
      You are a corruption investigation expert in India.
      Analyze the following location and tender data.
      Location: ${JSON.stringify(location)}
      Tenders: ${JSON.stringify(tenders)}
      Provide:
      - Budget analysis (is the budget reasonable?)
      - Quality concerns (does the contractor have a good track record?)
      - Fraud indicators (any red flags?)
      - Recommendations for further investigation.
      Format as a short report.
    `;
    const aiSummary = await callGemini(prompt);

    // 4. Generate PDF reports
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reports = [];
    const driveLinks = [];

    // Report 1 – Initial investigation
    const r1 = `report_1_${timestamp}.pdf`;
    await generatePDFReport(
      r1,
      'Initial Investigation Report – Government Tender',
      [
        {
          heading: 'Location Details',
          content: [JSON.stringify(location, null, 2)],
        },
        {
          heading: 'Tenders Found',
          content: [JSON.stringify(tenders, null, 2)],
        },
        {
          heading: 'AI Analysis',
          content: [aiSummary],
        },
      ]
    );
    reports.push(r1);
    driveLinks.push(await uploadToDrive(r1));

    // Report 2 – Supplier / Contractor fraud
    const r2 = `report_2_${timestamp}.pdf`;
    await generatePDFReport(
      r2,
      'Supplier Fraud & Quality Analysis',
      [
        {
          heading: 'Contractor History',
          content: ['Check past performance, complaints, and quality claims.'],
        },
        {
          heading: 'Red Flags',
          content: ['Possible overpricing, incomplete past projects, or use of substandard materials.'],
        },
        {
          heading: 'Recommendations',
          content: ['Verify bills and material certificates; compare with market rates.'],
        },
      ]
    );
    reports.push(r2);
    driveLinks.push(await uploadToDrive(r2));

    // RTI draft
    const rtiQuestions = [
      'Provide complete details of the tender including all bidders and their financial quotes.',
      'Provide quality certificates and test reports of materials used.',
      'Provide bills and payment records for the work done.',
      'Provide inspection reports and compliance certificates.',
    ];
    const rtiDraft = generateRTIDraft(
      'Corruption Investigation in Tender',
      tenders[0]?.department || 'Public Works Department',
      rtiQuestions
    );

    // Report 3 – Final complaint with RTI and evidence
    const r3 = `report_3_final_${timestamp}.pdf`;
    await generatePDFReport(
      r3,
      'Final Complaint – Corruption in Government Tender',
      [
        {
          heading: 'Summary of Findings',
          content: [aiSummary.substring(0, 500)],
        },
        {
          heading: 'RTI Application Draft',
          content: [rtiDraft],
        },
        {
          heading: 'Evidence / Supporting Documents',
          content: ['List of evidence will be attached here (GPS coordinates, photos, etc.).'],
        },
      ],
      [{ desc: 'GPS Location & Timestamp', src: `Lat ${lat}, Lon ${lon}` }]
    );
    reports.push(r3);
    driveLinks.push(await uploadToDrive(r3));

    return {
      status: 'success',
      location: location,
      tenders: tenders,
      aiSummary: aiSummary,
      driveLinks: driveLinks,
      rtiDraft: rtiDraft,
      localFiles: reports,
    };
  } catch (error) {
    console.error('❌ Investigation failed:', error);
    return {
      status: 'error',
      error: error.message,
    };
  }
}

module.exports = { runInvestigation };