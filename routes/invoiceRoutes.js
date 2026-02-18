const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const PDFDocument = require('pdfkit');
const { connectDB, transporter } = require('../config/db');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

/** 1️⃣ GET INVOICES (Admin vs Client Logic) **/
router.get('/', async (req, res) => {
    try {
        const { search, status, email, role } = req.query;
        if (!email) return res.status(400).send({ error: "Email is required" });

        const database = await connectDB();
        const collection = database.collection("invoices");

        let query = role === 'admin' ? { adminEmail: email.toLowerCase() } : { clientEmail: email.toLowerCase() };

        if (search) {
            query.$or = [
                { invoiceId: { $regex: search, $options: 'i' } },
                { clientName: { $regex: search, $options: 'i' } },
                { projectTitle: { $regex: search, $options: 'i' } }
            ];
        }
        if (status && status !== 'All') query.status = status;

        const invoices = await collection.find(query).sort({ createdAt: -1 }).toArray();
        res.status(200).send(invoices);
    } catch (err) {
        res.status(500).send({ error: "Failed to fetch invoices" });
    }
});

/** 2️⃣ CREATE INVOICE **/
router.post('/', async (req, res) => {
    try {
        const database = await connectDB();
        const invoiceCollection = database.collection("invoices");
        const usersCollection = database.collection("users");

        const { adminEmail, clientEmail, ...rest } = req.body;
        if (!adminEmail || !clientEmail) return res.status(400).send({ error: "Emails are required" });

        const invoiceData = {
            ...rest,
            adminEmail: adminEmail.toLowerCase(),
            clientEmail: clientEmail.toLowerCase(),
            createdAt: new Date(),
            updatedAt: new Date(),
            status: req.body.status || "Unpaid"
        };

        const result = await invoiceCollection.insertOne(invoiceData);
        const savedInvoiceId = result.insertedId;

        const summaryData = {
            _id: savedInvoiceId,
            invoiceId: invoiceData.invoiceId,
            projectTitle: invoiceData.projectTitle,
            clientName: invoiceData.clientName,
            grandTotal: invoiceData.grandTotal,
            status: invoiceData.status,
            date: invoiceData.createdAt
        };

        await usersCollection.updateOne({ email: invoiceData.adminEmail }, { $push: { myCreatedInvoices: summaryData } });
        await usersCollection.updateOne({ email: invoiceData.clientEmail }, { $push: { invoicesReceived: summaryData } });

        res.status(201).send({ message: "✅ Invoice created & synced", id: savedInvoiceId });
    } catch (err) {
        res.status(500).send({ error: "Failed to create invoice" });
    }
});

/** 3️⃣ GET SINGLE INVOICE **/
router.get('/:id', async (req, res) => {
    try {
        const database = await connectDB();
        if (!ObjectId.isValid(req.params.id)) return res.status(400).send({ error: "Invalid ID" });
        const inv = await database.collection("invoices").findOne({ _id: new ObjectId(req.params.id) });
        inv ? res.send(inv) : res.status(404).send({ error: "Not found" });
    } catch (err) { res.status(500).send({ error: "Internal error" }); }
});

/** 4️⃣ SEND EMAIL (With Dynamic Settings Link & Auto-Status) **/
router.post('/send-email', upload.single('pdf'), async (req, res) => {
    try {
        const database = await connectDB();
        const settingsColl = database.collection("settings");
        const invColl = database.collection("invoices");
        const userColl = database.collection("users");

        const inv = JSON.parse(req.body.invoiceData);
        const pdfFile = req.file;
        if (!pdfFile) return res.status(400).send({ error: "PDF missing" });

        const siteSettings = await settingsColl.findOne({});
        const userProvidedLink = siteSettings?.paypalLink || inv.paypalEmail || process.env.PAYPAL_EMAIL;

        let finalPaymentLink = "";

        if (userProvidedLink.startsWith('http')) {
            finalPaymentLink = userProvidedLink;
        } else if (userProvidedLink.includes('@')) {
            finalPaymentLink = `https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=${userProvidedLink}&amount=${inv.remainingDue}&currency_code=${inv.currency}&item_name=Invoice_${inv.invoiceId}`;
        } else {
            const cleanID = userProvidedLink.replace('paypal.me/', '');
            finalPaymentLink = `https://paypal.me/${cleanID}/${inv.remainingDue}${inv.currency}`;
        }

        const emailHtml = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                <div style="background-color: #4177BC; padding: 40px 20px; color: white; text-align: center;">
                    <h2 style="margin: 0; font-size: 24px;">New Invoice Received</h2>
                    <p style="opacity: 0.9; margin-top: 8px;">Invoice #${inv.invoiceId}</p>
                </div>
                <div style="padding: 30px; text-align: center; color: #334155;">
                    <p style="font-size: 16px;">Hi <b>${inv.clientName}</b>, a new invoice for <b>${inv.projectTitle}</b> is ready.</p>
                    <div style="margin: 30px 0; padding: 20px; background-color: #f8fafc; border-radius: 12px;">
                        <span style="font-size: 12px; color: #64748b; font-weight: bold;">Amount Due</span>
                        <h1 style="margin: 8px 0; color: #0f172a; font-size: 32px;">${inv.currency} ${inv.remainingDue.toLocaleString()}</h1>
                    </div>
                    <a href="${finalPaymentLink}" style="display: inline-block; background-color: #4177BC; color: white; padding: 16px 40px; border-radius: 12px; text-decoration: none; font-weight: bold;">
                        Complete Payment Now
                    </a>
                </div>
                <div style="background-color: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #64748b;">
                    Sent via <b>Vault Ledger PRO</b> by Geniehack Ltd.
                </div>
            </div>`;

        await transporter.sendMail({
            from: `"Vault Billing" <${process.env.EMAIL_USER}>`,
            to: inv.clientEmail,
            subject: `Invoice #${inv.invoiceId} for ${inv.projectTitle}`,
            html: emailHtml,
            attachments: [{ filename: `Invoice_${inv.invoiceId}.pdf`, content: pdfFile.buffer }]
        });
        const updateQuery = { invoiceId: inv.invoiceId };
        await invColl.updateOne(updateQuery, { $set: { status: "Sent", updatedAt: new Date() } });

        const updated = await invColl.findOne(updateQuery);
        if (updated) {
            await userColl.updateOne({ email: updated.adminEmail, "myCreatedInvoices._id": updated._id }, { $set: { "myCreatedInvoices.$.status": "Sent" } });
            await userColl.updateOne({ email: updated.clientEmail, "invoicesReceived._id": updated._id }, { $set: { "invoicesReceived.$.status": "Sent" } });
        }

        res.status(200).send({ message: "✅ Email sent & status updated" });
    } catch (err) {
        res.status(500).send({ error: "Failed to send invoice" });
    }
});

/** 5️⃣ DOWNLOAD PDF **/
router.get('/:id/download', async (req, res) => {
    try {
        const database = await connectDB();
        const query = ObjectId.isValid(req.params.id) ? { _id: new ObjectId(req.params.id) } : { invoiceId: req.params.id };
        const inv = await database.collection("invoices").findOne(query);
        if (!inv) return res.status(404).send({ error: "Invoice not found" });

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Invoice-${inv.invoiceId}.pdf`);
        doc.pipe(res);

        // PDF Design
        doc.rect(0, 0, 600, 120).fill('#4177BC');
        doc.fillColor('#FFFFFF').fontSize(25).text('INVOICE', 50, 45);
        doc.fontSize(10).text(`Invoice Number: ${inv.invoiceId}`, 50, 80);
        doc.text(`Date: ${new Date(inv.createdAt).toLocaleDateString()}`, 50, 95);

        doc.fillColor('#333').fontSize(12).text('BILL TO:', 50, 150);
        doc.font('Helvetica-Bold').fontSize(11).text(inv.clientName || 'N/A', 50, 170);
        doc.font('Helvetica').text(inv.clientEmail, 50, 185);

        doc.rect(50, 220, 500, 20).fill('#f1f5f9');
        doc.fillColor('#475569').fontSize(10).text('Description', 60, 225);
        doc.text('Qty', 350, 225); doc.text('Price', 420, 225); doc.text('Total', 500, 225);

        let y = 250;
        (inv.items || []).forEach(item => {
            doc.fillColor('#333').text(item.name, 60, y);
            doc.text(item.qty.toString(), 350, y);
            doc.text(item.price.toLocaleString(), 420, y);
            doc.text((item.qty * item.price).toLocaleString(), 500, y);
            y += 20;
        });

        doc.rect(350, y + 20, 200, 30).fill('#4177BC');
        doc.fillColor('#FFF').font('Helvetica-Bold').text(`GRAND TOTAL: ${inv.currency} ${inv.grandTotal.toLocaleString()}`, 360, y + 30);
        doc.end();
    } catch (err) { res.status(500).send({ error: "PDF error" }); }
});

/** 6️⃣ PATCH (Global Update) - FIXED **/
router.patch('/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const invoiceColl = database.collection("invoices");
        const userColl = database.collection("users");

        const invoiceObjectId = ObjectId.isValid(req.params.id) ? new ObjectId(req.params.id) : null;
        if (!invoiceObjectId) return res.status(400).send({ error: "Invalid Invoice ID format" });

        const { _id, createdAt, ...updateFields } = req.body;

        const result = await invoiceColl.updateOne(
            { _id: invoiceObjectId },
            { $set: { ...updateFields, updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({ error: "Invoice not found" });
        }

        const updated = await invoiceColl.findOne({ _id: invoiceObjectId });

        if (updated) {
           
            await userColl.updateOne(
                { email: updated.adminEmail, "myCreatedInvoices._id": updated._id },
                {
                    $set: {
                        "myCreatedInvoices.$.status": updated.status,
                        "myCreatedInvoices.$.grandTotal": updated.grandTotal,
                        "myCreatedInvoices.$.projectTitle": updated.projectTitle,
                        "myCreatedInvoices.$.clientName": updated.clientName
                    }
                }
            );

            await userColl.updateOne(
                { email: updated.clientEmail, "invoicesReceived._id": updated._id },
                {
                    $set: {
                        "invoicesReceived.$.status": updated.status,
                        "invoicesReceived.$.grandTotal": updated.grandTotal,
                        "invoicesReceived.$.projectTitle": updated.projectTitle
                    }
                }
            );
        }

        res.send({ message: "✅ Global update successful", updatedStatus: updated.status });
    } catch (err) {
        console.error("Patch Error:", err);
        res.status(500).send({ error: "Update failed: " + err.message });
    }
});

/** 7️⃣ DELETE (Global Cleanup) **/
router.delete('/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const query = ObjectId.isValid(req.params.id) ? { _id: new ObjectId(req.params.id) } : { invoiceId: req.params.id };
        const inv = await database.collection("invoices").findOne(query);
        if (inv) {
            await database.collection("users").updateOne({ email: inv.adminEmail }, { $pull: { myCreatedInvoices: { _id: inv._id } } });
            await database.collection("users").updateOne({ email: inv.clientEmail }, { $pull: { invoicesReceived: { _id: inv._id } } });
            await database.collection("invoices").deleteOne({ _id: inv._id });
        }
        res.send({ message: "🗑️ Deleted globally" });
    } catch (err) { res.status(500).send({ error: "Delete failed" }); }
});

/** 8️⃣ BULK DELETE (Updated for Global Sync) **/
router.post('/bulk-delete', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids)) return res.status(400).send({ error: "Invalid IDs" });

        const database = await connectDB();
        const invoiceColl = database.collection("invoices");
        const userColl = database.collection("users");

        const objectIds = ids.map(id => new ObjectId(id));

        const invoicesToDelete = await invoiceColl.find({ _id: { $in: objectIds } }).toArray();

        for (const inv of invoicesToDelete) {
            await userColl.updateOne(
                { email: inv.adminEmail },
                { $pull: { myCreatedInvoices: { _id: inv._id } } }
            );
            await userColl.updateOne(
                { email: inv.clientEmail },
                { $pull: { invoicesReceived: { _id: inv._id } } }
            );
        }

        
        await invoiceColl.deleteMany({ _id: { $in: objectIds } });

        res.status(200).send({ message: `🗑️ ${ids.length} Invoices deleted globally` });
    } catch (err) {
        console.error("Bulk Delete Error:", err);
        res.status(500).send({ error: "Bulk delete failed" });
    }
});

/** 🔄 UPDATE INVOICE STATUS & TRIGGER NEXT MILESTONE **/
router.put('/update-status/:invoiceId', async (req, res) => {
    try {
        const { status } = req.body; // status should be "Paid"
        const database = await connectDB();
        const invoiceColl = database.collection("invoices");
        const clientColl = database.collection("clinets");

        const currentInvoice = await invoiceColl.findOneAndUpdate(
            { invoiceId: req.params.invoiceId },
            { $set: { status: status, updatedAt: new Date() } },
            { returnDocument: 'after' }
        );

        if (status === "Paid" && currentInvoice.projectId) {
            const client = await clientColl.findOne({ 
                "projects._id": currentInvoice.projectId 
            });

            const project = client.projects.find(p => p._id === currentInvoice.projectId);
            const nextStep = (project.currentStep || 1) + 1;
            const nextMilestone = project.milestones[nextStep - 1]; 

            if (nextMilestone) {
                const nextInvoiceData = {
                    invoiceId: `INV-${Date.now().toString().slice(-6)}`,
                    projectId: project._id,
                    projectTitle: project.name,
                    clientName: client.name,
                    clientEmail: client.email,
                    grandTotal: Number(nextMilestone.amount),
                    remainingDue: Number(nextMilestone.amount),
                    status: "Unpaid",
                    createdAt: new Date(),
                    items: [{ name: nextMilestone.name, qty: 1, price: Number(nextMilestone.amount) }]
                };

                await invoiceColl.insertOne(nextInvoiceData);

                await clientColl.updateOne(
                    { "projects._id": project._id },
                    { $set: { "projects.$.currentStep": nextStep } }
                );
            } else {
                await clientColl.updateOne(
                    { "projects._id": project._id },
                    { $set: { "projects.$.status": "Completed" } }
                );
            }
        }

        res.json({ success: true, message: "Status updated and next step triggered!" });
    } catch (err) {
        res.status(500).json({ error: "Automation failed" });
    }
});
router.put('/update-status/:invoiceId', async (req, res) => {
    try {
        const { status } = req.body; 
        const database = await connectDB();
        const invoiceColl = database.collection("invoices");
        const clientColl = database.collection("clients"); 
        const userColl = database.collection("users");

        // 1. Update current invoice
        const currentInvoice = await invoiceColl.findOneAndUpdate(
            { invoiceId: req.params.invoiceId },
            { $set: { status: status, updatedAt: new Date() } },
            { returnDocument: 'after' }
        );

        if (!currentInvoice) return res.status(404).send({ error: "Invoice not found" });

        // Sync Dashboard Status
        await userColl.updateOne({ email: currentInvoice.adminEmail, "myCreatedInvoices.invoiceId": currentInvoice.invoiceId }, { $set: { "myCreatedInvoices.$.status": status } });
        await userColl.updateOne({ email: currentInvoice.clientEmail, "invoicesReceived.invoiceId": currentInvoice.invoiceId }, { $set: { "invoicesReceived.$.status": status } });

        // 2. Automation Logic
        if (status === "Paid" && currentInvoice.projectId) {
            const client = await clientColl.findOne({ "projects._id": currentInvoice.projectId });
            const project = client.projects.find(p => p._id === currentInvoice.projectId);
            
            const nextStep = (project.currentStep || 1) + 1;
            const nextMilestone = project.milestones[nextStep - 1];

            if (nextMilestone) {
                // Generate Next Invoice
                const nextInvoiceData = {
                    invoiceId: `INV-${Date.now().toString().slice(-6)}`,
                    projectId: project._id,
                    projectTitle: project.name,
                    clientName: client.name,
                    clientEmail: client.email,
                    adminEmail: currentInvoice.adminEmail,
                    grandTotal: Number(nextMilestone.amount),
                    remainingDue: Number(nextMilestone.amount),
                    currency: currentInvoice.currency || "USD",
                    status: "Unpaid",
                    createdAt: new Date(),
                    items: [{ name: nextMilestone.name, qty: 1, price: Number(nextMilestone.amount) }]
                };

                const savedNext = await invoiceColl.insertOne(nextInvoiceData);
                
                // Sync Next Invoice to Dashboards
                const summary = { _id: savedNext.insertedId, invoiceId: nextInvoiceData.invoiceId, projectTitle: nextInvoiceData.projectTitle, clientName: nextInvoiceData.clientName, grandTotal: nextInvoiceData.grandTotal, status: "Unpaid", date: new Date() };
                await userColl.updateOne({ email: nextInvoiceData.adminEmail }, { $push: { myCreatedInvoices: summary } });
                await userColl.updateOne({ email: nextInvoiceData.clientEmail }, { $push: { invoicesReceived: summary } });

                // Update Project Progress
                await clientColl.updateOne(
                    { "projects._id": project._id },
                    { $set: { "projects.$.currentStep": nextStep } }
                );
            } else {
                await clientColl.updateOne({ "projects._id": project._id }, { $set: { "projects.$.status": "Completed" } });
            }
        }

        res.json({ success: true, message: "Status updated & next milestone triggered!" });
    } catch (err) { res.status(500).json({ error: "Automation failed" }); }
});

module.exports = router;