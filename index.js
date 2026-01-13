const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const PDFDocument = require('pdfkit'); // শুধু এটি যোগ করা হয়েছে PDF এর জন্য

const app = express();
const port = process.env.PORT || 5000;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- MongoDB URI ---
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// --- DB Cache ---
let db;

async function connectDB() {
  if (db) return db;
  await client.connect();
  db = client.db("invoice");
  console.log("✅ MongoDB Connected");
  return db;
}

// --- Root ---
app.get('/', (req, res) => {
  res.send('🚀 Vault Server Running');
});

/**
 * 1️⃣ GET ALL CLIENTS
 */
app.get('/clinets', async (req, res) => {
  try {
    const { search, status } = req.query;
    const database = await connectDB();
    const collection = database.collection("clinets");

    let query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } }
      ];
    }
    if (status && status !== 'All') query.status = status;

    const clients = await collection.find(query).sort({ createdAt: -1 }).toArray();
    res.send(clients);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch clients" });
  }
});

/**
 * 2️⃣ GET SINGLE CLIENT
 */
app.get('/clinets/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).send({ error: "Invalid ID" });

    const database = await connectDB();
    const collection = database.collection("clinets");

    const clientData = await collection.findOne({ _id: new ObjectId(req.params.id) });
    if (!clientData) return res.status(404).send({ error: "Client not found" });

    res.send(clientData);
  } catch {
    res.status(500).send({ error: "Server error" });
  }
});

/**
 * 3️⃣ CREATE CLIENT (AUTO PROJECT ID)
 */
app.post('/clinets', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection("clinets");

    const newClient = {
      ...req.body,
      status: req.body.status || "Active",
      createdAt: new Date(),
      projects: (req.body.projects || []).map(p => ({
        _id: new ObjectId().toString(),
        name: p.name,
        budget: p.budget,
        description: p.description,
        type: p.type,
        status: p.status || "Active",
        milestones: p.milestones || []
      }))
    };

    const result = await collection.insertOne(newClient);
    res.status(201).send(result);
  } catch {
    res.status(500).send({ error: "Failed to add client" });
  }
});

/**
 * 4️⃣ UPDATE CLIENT (SAFE PROJECT HANDLING)
 */
app.put('/clinets/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).send({ error: "Invalid ID" });

    const database = await connectDB();
    const collection = database.collection("clinets");

    const { _id, projects, ...rest } = req.body;

    const updateData = {
      ...rest,
      updatedAt: new Date()
    };

    if (projects) {
      updateData.projects = projects.map(p => ({
        _id: p._id || new ObjectId().toString(),
        name: p.name,
        budget: p.budget,
        description: p.description,
        type: p.type,
        status: p.status || "Active",
        milestones: p.milestones || []
      }));
    }

    const result = await collection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updateData }
    );

    if (!result.matchedCount)
      return res.status(404).send({ error: "Client not found" });

    res.send({ message: "✅ Client updated" });
  } catch {
    res.status(500).send({ error: "Update failed" });
  }
});

/**
 * 5️⃣ UPDATE SINGLE PROJECT STATUS (FIXED)
 */
app.put('/clinets/:clientId/projects/:projectId', async (req, res) => {
  const { clientId, projectId } = req.params;
  const { status } = req.body;

  try {
    const database = await connectDB();
    const collection = database.collection("clinets");

    const result = await collection.updateOne(
      {
        _id: new ObjectId(clientId),
        projects: { $elemMatch: { _id: projectId } }
      },
      {
        $set: { "projects.$.status": status }
      }
    );

    if (!result.matchedCount)
      return res.status(404).send({ message: "Project not found" });

    res.send({ message: "✅ Project status updated", status });
  } catch (err) {
    res.status(500).send({ message: "Update failed", error: err.message });
  }
});

/**
 * 6️⃣ DELETE CLIENT
 */
app.delete('/clinets/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).send({ error: "Invalid ID" });

    const database = await connectDB();
    const collection = database.collection("clinets");

    const result = await collection.deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount)
      return res.status(404).send({ error: "Client not found" });

    res.send({ message: "🗑️ Client deleted" });
  } catch {
    res.status(500).send({ error: "Delete failed" });
  }
});

app.get('/invoices', async (req, res) => {
  try {
    const { search, status } = req.query;
    const database = await connectDB();
    const collection = database.collection("invoices");

    let query = {};
    if (search) {
      query.$or = [
        { invoiceId: { $regex: search, $options: 'i' } },
        { "client.name": { $regex: search, $options: 'i' } },
        { projectTitle: { $regex: search, $options: 'i' } }
      ];
    }
    if (status && status !== 'All') query.status = status;

    const invoices = await collection.find(query).sort({ createdAt: -1 }).toArray();
    res.send(invoices);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch invoices" });
  }
});

/** 6. GET SINGLE INVOICE (By invoiceId or ObjectId) */
app.get('/invoices/:id', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection("invoices");
    const query = ObjectId.isValid(req.params.id)
      ? { _id: new ObjectId(req.params.id) }
      : { invoiceId: req.params.id };

    const invoice = await collection.findOne(query);
    if (!invoice) return res.status(404).send({ error: "Invoice not found" });
    res.send(invoice);
  } catch {
    res.status(500).send({ error: "Server error" });
  }
});

/** 7. CREATE NEW INVOICE */
app.post('/invoices', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection("invoices");

    const newInvoice = {
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await collection.insertOne(newInvoice);
    res.status(201).send({ message: "✅ Invoice created successfully", result });
  } catch (err) {
    res.status(500).send({ error: "Failed to create invoice" });
  }
});

/** 8. UPDATE INVOICE STATUS */
app.patch('/invoices/:id', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection("invoices");
    const { status, receivedAmount, remainingDue } = req.body;

    const result = await collection.updateOne(
      { invoiceId: req.params.id },
      { $set: { status, receivedAmount, remainingDue, updatedAt: new Date() } }
    );

    res.send({ message: "✅ Invoice updated", result });
  } catch {
    res.status(500).send({ error: "Update failed" });
  }
});

/** 9. DELETE INVOICE */
app.delete('/invoices/:id', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection("invoices");
    const query = ObjectId.isValid(req.params.id)
      ? { _id: new ObjectId(req.params.id) }
      : { invoiceId: req.params.id };

    const result = await collection.deleteOne(query);
    res.send({ message: "🗑️ Invoice deleted", result });
  } catch {
    res.status(500).send({ error: "Delete failed" });
  }
});

/** 10. DOWNLOAD INVOICE PDF (MODERN DESIGN) */
app.get('/invoices/:id/download', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection("invoices");

    const query = ObjectId.isValid(req.params.id)
      ? { _id: new ObjectId(req.params.id) }
      : { invoiceId: req.params.id };

    const inv = await collection.findOne(query);
    if (!inv) return res.status(404).send({ error: "Invoice not found" });

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Invoice-${inv.invoiceId}.pdf`);

    doc.pipe(res);

    // --- Modern Header ---
    doc.rect(0, 0, 600, 120).fill('#F4F7FB'); // হালকা ব্লু ব্যাকগ্রাউন্ড
    doc.fillColor('#1A3353').fontSize(24).font('Helvetica-Bold').text('INVOICE', 40, 45);

    doc.fontSize(10).font('Helvetica').fillColor('#555555');
    doc.text(`Invoice Number: ${inv.invoiceId}`, 40, 75);
    doc.text(`Issued Date: ${new Date(inv.createdAt).toLocaleDateString()}`, 40, 90);

    // Status Badge (Paid/Unpaid)
    const statusColor = inv.status === 'Paid' ? '#2ECC71' : '#E74C3C';
    doc.rect(450, 45, 100, 25).fill(statusColor);
    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold').text(inv.status.toUpperCase(), 450, 52, { width: 100, align: 'center' });

    // --- Bill To & Details ---
    doc.moveDown(5);
    doc.fillColor('#1A3353').fontSize(12).font('Helvetica-Bold').text('CLIENT DETAILS', 40, 150);
    doc.strokeColor('#1A3353').lineWidth(1).moveTo(40, 165).lineTo(150, 165).stroke();

    doc.moveDown(1);
    doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text(inv.client?.name || 'Client Name', 40, 175);
    doc.fontSize(10).font('Helvetica').fillColor('#555555').text(`Project: ${inv.projectTitle}`, 40, 195);
    if (inv.client?.email) doc.text(`Email: ${inv.client.email}`, 40, 210);

    // --- Table Header ---
    const tableTop = 260;
    doc.rect(40, tableTop, 515, 30).fill('#1A3353'); // নেভি ব্লু হেডার
    doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold').text('DESCRIPTION', 55, tableTop + 10);
    doc.text('TOTAL AMOUNT', 400, tableTop + 10, { width: 140, align: 'right' });

    // --- Table Row ---
    const rowTop = tableTop + 45;
    doc.fillColor('#000000').fontSize(10).font('Helvetica').text(inv.projectTitle, 55, rowTop);
    doc.font('Helvetica-Bold').text(`${inv.currency} ${inv.grandTotal?.toLocaleString()}`, 400, rowTop, { width: 140, align: 'right' });

    
    doc.strokeColor('#EEEEEE').lineWidth(1).moveTo(40, rowTop + 20).lineTo(555, rowTop + 20).stroke();

    // --- Summary Section ---
    const summaryTop = rowTop + 60;

    // Received Amount
    doc.fillColor('#555555').font('Helvetica').text('Received Amount:', 350, summaryTop);
    doc.fillColor('#000000').text(`${inv.currency} ${inv.receivedAmount?.toLocaleString() || 0}`, 450, summaryTop, { width: 100, align: 'right' });

    // Remaining Due
    doc.fillColor('#555555').text('Remaining Due:', 350, summaryTop + 20);
    doc.fillColor('#E74C3C').font('Helvetica-Bold').text(`${inv.currency} ${inv.remainingDue?.toLocaleString() || 0}`, 450, summaryTop + 20, { width: 100, align: 'right' });

    // Grand Total Box
    doc.rect(340, summaryTop + 45, 215, 40).fill('#1A3353');
    doc.fillColor('#FFFFFF').fontSize(12).text('TOTAL BALANCE', 355, summaryTop + 58);
    doc.fontSize(14).text(`${inv.currency} ${inv.grandTotal?.toLocaleString()}`, 440, summaryTop + 57, { width: 100, align: 'right' });

    // --- Footer ---
    const footerTop = 750;
    doc.strokeColor('#EEEEEE').lineWidth(1).moveTo(40, footerTop).lineTo(555, footerTop).stroke();
    doc.fillColor('#999999').fontSize(9).font('Helvetica').text('This is a computer-generated invoice, no signature required.', 40, footerTop + 15, { align: 'center', width: 515 });
    doc.fillColor('#1A3353').font('Helvetica-Bold').text('Thank you for choosing our services!', 40, footerTop + 30, { align: 'center', width: 515 });

    doc.end();
  } catch (err) {
    console.error("PDF Error:", err);
    res.status(500).send({ error: "Download failed" });
  }
});
// --- START SERVER ---
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});

module.exports = app;