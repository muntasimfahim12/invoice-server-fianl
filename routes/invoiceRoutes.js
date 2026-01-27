const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const PDFDocument = require('pdfkit');
const { connectDB, transporter } = require('../config/db');

/** 1️⃣ GET INVOICES (Admin vs Client Logic - Fully Intact) **/
router.get('/', async (req, res) => {
    try {
        const { search, status, email, role } = req.query;

        if (!email) {
            return res.status(400).send({ error: "Authentication email is required to fetch data" });
        }

        const database = await connectDB();
        const collection = database.collection("invoices");

        // Admin Sees all created by them, Client sees only assigned to them
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

/** 2️⃣ CREATE INVOICE (Updates Main, Admin & Client Collections) **/
router.post('/', async (req, res) => {
    try {
        const database = await connectDB();
        const invoiceCollection = database.collection("invoices");
        const usersCollection = database.collection("users");

        const { adminEmail, clientEmail, ...rest } = req.body;

        if (!adminEmail || !clientEmail) {
            return res.status(400).send({ error: "Admin and Client emails are required" });
        }

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
        await usersCollection.updateOne(
            { email: invoiceData.adminEmail },
            { $push: { myCreatedInvoices: summaryData } }
        );

        await usersCollection.updateOne(
            { email: invoiceData.clientEmail },
            { $push: { invoicesReceived: summaryData } }
        );

        res.status(201).send({ message: "✅ Invoice created & synced globally", id: savedInvoiceId });
    } catch (err) {
        console.error("❌ Create Error:", err);
        res.status(500).send({ error: "Failed to create invoice" });
    }
});

/** 3️⃣ GET SINGLE INVOICE **/
router.get('/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const collection = database.collection("invoices");

        if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).send({ error: "Invalid Object ID" });
        }

        const inv = await collection.findOne({ _id: new ObjectId(req.params.id) });
        if (!inv) return res.status(404).send({ error: "Invoice not found" });

        res.send(inv);
    } catch (err) {
        res.status(500).send({ error: "Internal server error" });
    }
});

/** 4️⃣ SEND PROFESSIONAL EMAIL (HTML Design Kept Exact) **/
router.post('/send-email', async (req, res) => {
    try {
        const inv = req.body;
        const clientEmail = inv.clientEmail || inv.client?.email;

        if (!clientEmail) return res.status(400).send({ error: "Client email missing" });

        const itemRows = (inv.items || []).map(item => `
            <tr>
                <td style="padding: 12px; border-bottom: 1px solid #edf2f7;">${item.name}</td>
                <td style="padding: 12px; border-bottom: 1px solid #edf2f7; text-align: center;">${item.qty}</td>
                <td style="padding: 12px; border-bottom: 1px solid #edf2f7; text-align: right; font-weight: bold;">
                    ${inv.currency} ${(item.qty * (item.price || 0)).toLocaleString()}
                </td>
            </tr>
        `).join('');

        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                <div style="background-color: #4177BC; padding: 30px; color: white; text-align: center;">
                    <h2>INVOICE ${inv.invoiceId}</h2>
                </div>
                <div style="padding: 20px;">
                    <p>Hi ${inv.clientName}, you have a new invoice for <b>${inv.projectTitle}</b>.</p>
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f8fafc;">
                                <th style="text-align: left; padding: 10px;">Item</th>
                                <th style="text-align: center; padding: 10px;">Qty</th>
                                <th style="text-align: right; padding: 10px;">Total</th>
                            </tr>
                        </thead>
                        <tbody>${itemRows}</tbody>
                    </table>
                    <h3 style="text-align: right; color: #4177BC;">Total Due: ${inv.currency} ${inv.grandTotal?.toLocaleString()}</h3>
                </div>
            </div>`;

        await transporter.sendMail({
            from: `"Vault Billing" <${process.env.EMAIL_USER}>`,
            to: clientEmail,
            subject: `Action Required: Invoice ${inv.invoiceId}`,
            html: emailHtml
        });

        res.status(200).send({ message: "✅ Email sent" });
    } catch (err) {
        res.status(500).send({ error: "Email delivery failed" });
    }
});

/** 5️⃣ DOWNLOAD PDF (With Improved Table Layout) **/
router.get('/:id/download', async (req, res) => {
    try {
        const database = await connectDB();
        const collection = database.collection("invoices");
        const query = ObjectId.isValid(req.params.id) ? { _id: new ObjectId(req.params.id) } : { invoiceId: req.params.id };
        const inv = await collection.findOne(query);

        if (!inv) return res.status(404).send({ error: "Invoice not found" });

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Invoice-${inv.invoiceId}.pdf`);
        doc.pipe(res);

        doc.rect(0, 0, 600, 120).fill('#4177BC');
        doc.fillColor('#FFFFFF').fontSize(25).text('INVOICE', 50, 45);
        doc.fontSize(10).text(`Invoice Number: ${inv.invoiceId}`, 50, 80);
        doc.text(`Date: ${new Date(inv.createdAt).toLocaleDateString()}`, 50, 95);

        doc.fillColor('#333').fontSize(12).text('BILL TO:', 50, 150);
        doc.font('Helvetica-Bold').fontSize(11).text(inv.clientName || 'N/A', 50, 170);
        doc.font('Helvetica').text(inv.clientEmail, 50, 185);

        doc.rect(50, 220, 500, 20).fill('#f1f5f9');
        doc.fillColor('#475569').fontSize(10).text('Item Description', 60, 225);
        doc.text('Qty', 350, 225);
        doc.text('Price', 420, 225);
        doc.text('Total', 500, 225);

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
    } catch (err) {
        res.status(500).send({ error: "PDF Generation failed" });
    }
});

/** 6️⃣ PATCH (Sync Updates Across All Records) **/
router.patch('/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const invColl = database.collection("invoices");
        const userColl = database.collection("users");
        const query = ObjectId.isValid(req.params.id) ? { _id: new ObjectId(req.params.id) } : { invoiceId: req.params.id };

        const updateDoc = { $set: { ...req.body, updatedAt: new Date() } };
        await invColl.updateOne(query, updateDoc);

        const updatedInv = await invColl.findOne(query);
        if (updatedInv) {
            const syncId = updatedInv._id;
            // Admin list sync
            await userColl.updateOne(
                { email: updatedInv.adminEmail, "myCreatedInvoices._id": syncId },
                { $set: { "myCreatedInvoices.$.status": updatedInv.status, "myCreatedInvoices.$.grandTotal": updatedInv.grandTotal } }
            );
            // Client list sync
            await userColl.updateOne(
                { email: updatedInv.clientEmail, "invoicesReceived._id": syncId },
                { $set: { "invoicesReceived.$.status": updatedInv.status, "invoicesReceived.$.grandTotal": updatedInv.grandTotal } }
            );
        }

        res.send({ message: "✅ Global update successful" });
    } catch (err) { res.status(500).send({ error: "Update failed" }); }
});

/** 7️⃣ DELETE (Global Cleanup) **/
router.delete('/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const invColl = database.collection("invoices");
        const userColl = database.collection("users");
        const query = ObjectId.isValid(req.params.id) ? { _id: new ObjectId(req.params.id) } : { invoiceId: req.params.id };

        const invoiceToDelete = await invColl.findOne(query);

        if (invoiceToDelete) {
            const delId = invoiceToDelete._id;
            // Pull from Admin
            await userColl.updateOne({ email: invoiceToDelete.adminEmail }, { $pull: { myCreatedInvoices: { _id: delId } } });
            // Pull from Client
            await userColl.updateOne({ email: invoiceToDelete.clientEmail }, { $pull: { invoicesReceived: { _id: delId } } });
            // Delete Main
            await invColl.deleteOne({ _id: delId });
        }

        res.send({ message: "🗑️ Deleted from all records" });
    } catch (err) { res.status(500).send({ error: "Delete failed" }); }
});

module.exports = router;