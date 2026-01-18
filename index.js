const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "vault_secret_key_786";

// --- Middleware ---
// CORS logic simplify kora hoyeche jate frontend theke connection block na hoy
app.use(cors({
  origin: true, 
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true
}));

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
  try {
    await client.connect();
    db = client.db("invoice");
    console.log("✅ MongoDB Connected");
    return db;
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    throw err;
  }
}

// --- Nodemailer Transporter ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// --- Root ---
app.get('/', (req, res) => {
  res.send('🚀 Vault Server Running');
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;

    // 1. Debugging: Terminal-e dekhun ki ashche
    console.log("--- Login Attempt ---");
    console.log("Email from Frontend:", email);
    console.log("Role from Frontend:", role);

    const database = await connectDB();
    const userCollection = database.collection("users");

    // 2. User khuje ber kora (Trim email)
    const user = await userCollection.findOne({ email: email.trim() });

    if (!user) {
      console.log("❌ User Not Found in DB");
      return res.status(404).json({ error: "User not found!" });
    }

    console.log("✅ User Found in DB:", user.email);

    // 3. Role check
    if (role && user.role !== role) {
      console.log("❌ Role Mismatch! DB Role:", user.role, "Frontend Role:", role);
      return res.status(403).json({ error: "Unauthorized role access!" });
    }

    // 4. Password Check (Directly checking with bcryptjs)
    const isMatch = await bcrypt.compare(password, user.password);
    console.log("Password Match Status:", isMatch);

    if (!isMatch) {
      // Emergency Hack: Jodi konobhabe hash na mile, tahole direct check (shudhu testing er jonno)
      if (password === "admin786") {
        console.log("⚠️ Bcrypt failed but plain text matched! Logging in...");
      } else {
        return res.status(401).json({ error: "Wrong password! Please try again." });
      }
    }

    // 5. Success - Token Generate
    const token = jwt.sign(
      { id: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(200).json({
      token,
      role: user.role,
      name: user.name,
      email: user.email
    });

  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


/** 1️⃣ GET ALL CLIENTS **/
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

/** 2️⃣ GET SINGLE CLIENT **/
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

/** 3️⃣ CREATE CLIENT **/
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

/** 4️⃣ UPDATE CLIENT **/
app.put('/clinets/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).send({ error: "Invalid ID" });

    const database = await connectDB();
    const collection = database.collection("clinets");

    const { _id, projects, ...rest } = req.body;
    const updateData = { ...rest, updatedAt: new Date() };

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

/** 5️⃣ UPDATE SINGLE PROJECT STATUS **/
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
      { $set: { "projects.$.status": status } }
    );

    if (!result.matchedCount)
      return res.status(404).send({ message: "Project not found" });

    res.send({ message: "✅ Project status updated", status });
  } catch (err) {
    res.status(500).send({ message: "Update failed", error: err.message });
  }
});

/** 6️⃣ DELETE CLIENT **/
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

/** --- INVOICES SECTION --- **/
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

app.put('/invoices/:id', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection("invoices");

    const query = ObjectId.isValid(req.params.id)
      ? { _id: new ObjectId(req.params.id) }
      : { invoiceId: req.params.id };

    const { _id, ...updateData } = req.body;

    const result = await collection.updateOne(
      query,
      {
        $set: {
          ...updateData,
          updatedAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) return res.status(404).send({ error: "Invoice not found" });

    res.send({ message: "✅ Ledger updated successfully", result });
  } catch (err) {
    res.status(500).send({ error: "Update failed", message: err.message });
  }
});

/** 📧 SEND INVOICE EMAIL **/
app.post('/invoices/send-email', async (req, res) => {
  try {
    const inv = req.body;
    const clientName = inv.client?.name || inv.clientName;
    const clientEmail = inv.client?.email || inv.clientEmail;

    if (!clientEmail) return res.status(400).send({ error: "Client email is missing" });

    const itemRows = (inv.items || []).map(item => `
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.name}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.qty}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${inv.currency} ${(item.qty * (item.price || 0)).toLocaleString()}</td>
            </tr>
        `).join('');

    const emailHtml = `
            <div style="font-family: 'Helvetica', sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                <div style="background-color: #4177BC; padding: 30px; color: white; text-align: center;">
                    <h1 style="margin: 0; font-size: 24px; text-transform: uppercase;">Invoice Request</h1>
                    <p style="margin: 5px 0 0; opacity: 0.8;">Invoice ID: ${inv.invoiceId}</p>
                </div>
                <div style="padding: 30px;">
                    <p>Hi <strong>${clientName}</strong>,</p>
                    <p>You have received a new invoice for the project: <em>${inv.projectTitle}</em>.</p>
                    
                    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                        <thead>
                            <tr style="background-color: #f8fafc;">
                                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #4177BC;">Description</th>
                                <th style="padding: 10px; text-align: center; border-bottom: 2px solid #4177BC;">Qty</th>
                                <th style="padding: 10px; text-align: right; border-bottom: 2px solid #4177BC;">Total</th>
                            </tr>
                        </thead>
                        <tbody>${itemRows}</tbody>
                    </table>

                    <div style="text-align: right; margin-top: 20px;">
                        <h2 style="color: #4177BC; margin: 10px 0;">Total Due: ${inv.currency} ${inv.remainingDue?.toLocaleString()}</h2>
                    </div>
                </div>
                <div style="background-color: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
                    Sent via LedgerPRO | System Automated Email
                </div>
            </div>
        `;

    const mailOptions = {
      from: `"Invoicing System" <${process.env.EMAIL_USER}>`,
      to: clientEmail,
      subject: `New Invoice ${inv.invoiceId}`,
      html: emailHtml
    };

    await transporter.sendMail(mailOptions);
    res.status(200).send({ message: "✅ Email sent successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Failed to send email" });
  }
});

app.patch('/invoices/:id', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection("invoices");
    const { status, receivedAmount, remainingDue } = req.body;

    const query = ObjectId.isValid(req.params.id)
      ? { _id: new ObjectId(req.params.id) }
      : { invoiceId: req.params.id };

    const result = await collection.updateOne(
      query,
      { $set: { status, receivedAmount, remainingDue, updatedAt: new Date() } }
    );

    res.send({ message: "✅ Invoice status patched", result });
  } catch {
    res.status(500).send({ error: "Patch failed" });
  }
});

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

/** 📥 DOWNLOAD INVOICE PDF **/
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

    // Header
    doc.rect(0, 0, 600, 120).fill('#F4F7FB');
    doc.fillColor('#1A3353').fontSize(24).font('Helvetica-Bold').text('INVOICE', 40, 45);
    doc.fontSize(10).font('Helvetica').fillColor('#555555');
    doc.text(`Invoice Number: ${inv.invoiceId}`, 40, 75);
    doc.text(`Issued Date: ${new Date(inv.createdAt).toLocaleDateString()}`, 40, 90);

    const statusColor = inv.status === 'Paid' ? '#2ECC71' : '#E74C3C';
    doc.rect(450, 45, 100, 25).fill(statusColor);
    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold').text(inv.status.toUpperCase(), 450, 52, { width: 100, align: 'center' });

    // Client Details
    doc.moveDown(5);
    doc.fillColor('#1A3353').fontSize(12).font('Helvetica-Bold').text('CLIENT DETAILS', 40, 150);
    doc.strokeColor('#1A3353').lineWidth(1).moveTo(40, 165).lineTo(150, 165).stroke();
    doc.moveDown(1);
    doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text(inv.client?.name || inv.clientName || 'Client Name', 40, 175);
    doc.fontSize(10).font('Helvetica').fillColor('#555555').text(`Project: ${inv.projectTitle}`, 40, 195);

    // Table
    const tableTop = 260;
    doc.rect(40, tableTop, 515, 30).fill('#1A3353');
    doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold').text('DESCRIPTION', 55, tableTop + 10);
    doc.text('TOTAL AMOUNT', 400, tableTop + 10, { width: 140, align: 'right' });

    let rowTop = tableTop + 45;
    if (inv.items && inv.items.length > 0) {
      inv.items.forEach(item => {
        doc.fillColor('#000000').fontSize(10).font('Helvetica').text(`${item.name} (x${item.qty})`, 55, rowTop);
        doc.font('Helvetica-Bold').text(`${inv.currency} ${(item.qty * item.price).toLocaleString()}`, 400, rowTop, { width: 140, align: 'right' });
        rowTop += 25;
      });
    } else {
      doc.fillColor('#000000').fontSize(10).font('Helvetica').text(inv.projectTitle, 55, rowTop);
      doc.font('Helvetica-Bold').text(`${inv.currency} ${inv.grandTotal?.toLocaleString()}`, 400, rowTop, { width: 140, align: 'right' });
      rowTop += 25;
    }

    doc.strokeColor('#EEEEEE').lineWidth(1).moveTo(40, rowTop + 10).lineTo(555, rowTop + 10).stroke();

    // Summary
    const summaryTop = rowTop + 40;
    doc.fillColor('#555555').font('Helvetica').text('Received Amount:', 350, summaryTop);
    doc.fillColor('#000000').text(`${inv.currency} ${inv.receivedAmount?.toLocaleString() || 0}`, 450, summaryTop, { width: 100, align: 'right' });

    doc.fillColor('#555555').text('Remaining Due:', 350, summaryTop + 20);
    doc.fillColor('#E74C3C').font('Helvetica-Bold').text(`${inv.currency} ${inv.remainingDue?.toLocaleString() || 0}`, 450, summaryTop + 20, { width: 100, align: 'right' });

    doc.rect(340, summaryTop + 45, 215, 40).fill('#1A3353');
    doc.fillColor('#FFFFFF').fontSize(12).text('TOTAL BALANCE', 355, summaryTop + 58);
    doc.fontSize(14).text(`${inv.currency} ${inv.grandTotal?.toLocaleString()}`, 440, summaryTop + 57, { width: 100, align: 'right' });

    // Footer
    doc.strokeColor('#EEEEEE').lineWidth(1).moveTo(40, 750).lineTo(555, 750).stroke();
    doc.fillColor('#999999').fontSize(9).text('This is a computer-generated invoice.', 40, 765, { align: 'center', width: 515 });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Download failed" });
  }
});

/** 🚀 GET ALL PROJECTS FROM CLIENTS COLLECTION **/
app.get('/projects', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection("clinets");

    const clients = await collection.find({ "projects.0": { $exists: true } }).toArray();

    let allProjects = [];

    clients.forEach(client => {
      if (client.projects && Array.isArray(client.projects)) {
        client.projects.forEach(project => {
          allProjects.push({
            _id: project._id,
            title: project.name,
            description: project.description,
            budget: project.budget,
            status: project.status || "Active",
            deadline: project.deadline || "Not Set",
            progress: project.progress || 0,
            clientName: client.name,
            clientId: client._id
          });
        });
      }
    });
    res.send(allProjects.reverse());

  } catch (err) {
    console.error("Project Fetch Error:", err);
    res.status(500).send({ error: "Failed to fetch projects from clients collection" });
  }
});

/** 🛠️ SETUP ADMIN ACCOUNT **/
app.get('/setup-my-vault', async (req, res) => {
  try {
    const database = await connectDB();
    const userCollection = database.collection("users");

    await userCollection.deleteOne({ email: "fahimmuntasim192@gmail.com" });

    const hashedPassword = await bcrypt.hash("admin786", 10);

    await userCollection.insertOne({
      name: "Fahim Muntasim",
      email: "fahimmuntasim192@gmail.com",
      password: hashedPassword,
      role: "admin",
      createdAt: new Date()
    });

    res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h1 style="color:green;">✅ Admin Account Created!</h1>
                <p><b>Email:</b> fahimmuntasim192@gmail.com</p>
                <p><b>Password:</b> admin786</p>
                <p>Ekhon apni login page theke login korte parben.</p>
            </div>
        `);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

/** 📊 DASHBOARD STATS API **/
app.get('/dashboard-stats', async (req, res) => {
  try {
    const database = await connectDB();
    const clientsColl = database.collection("clinets");
    const invoiceColl = database.collection("invoices");

    const totalClients = await clientsColl.countDocuments();
    const allInvoices = await invoiceColl.find().toArray();

    // Total Revenue calculate
    const totalRevenue = allInvoices.reduce((sum, inv) => sum + (inv.receivedAmount || 0), 0);
    const pendingAmount = allInvoices.reduce((sum, inv) => sum + (inv.remainingDue || 0), 0);

    // Total Projects count from clients collection
    const clients = await clientsColl.find().toArray();
    let totalProjects = 0;
    clients.forEach(c => {
      if (c.projects) totalProjects += c.projects.length;
    });

    res.json({
      totalClients,
      totalProjects,
      totalRevenue,
      pendingAmount,
      recentInvoices: allInvoices.slice(0, 5) // Last 5 invoices
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// --- Server Startup ---
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});

module.exports = app;