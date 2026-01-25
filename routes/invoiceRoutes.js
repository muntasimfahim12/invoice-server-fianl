const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const PDFDocument = require('pdfkit');
const { connectDB, transporter } = require('../config/db');

/** 1️⃣ GET INVOICES (Admin vs Client Logic) **/
router.get('/', async (req, res) => {
    try {
        const { search, status, email, role } = req.query;
        if (!email) return res.status(400).send({ error: "Email is required" });

        const database = await connectDB();
        const collection = database.collection("invoices");

        // Admin sees all created by them, Client sees only assigned to them
        let query = role === 'admin' ? { adminEmail: email } : { clientEmail: email.toLowerCase() };

        if (search) {
            query.$or = [
                { invoiceId: { $regex: search, $options: 'i' } },
                { clientName: { $regex: search, $options: 'i' } },
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

/** 2️⃣ CREATE INVOICE (Updates Two Collections) **/
router.post('/', async (req, res) => {
    try {
        const database = await connectDB();
        const invoiceCollection = database.collection("invoices");
        const usersCollection = database.collection("users");

        const invoiceData = { 
            ...req.body, 
            clientEmail: req.body.clientEmail.toLowerCase(), 
            createdAt: new Date(), 
            updatedAt: new Date(),
            status: req.body.status || "Unpaid" 
        };

        // ১. 'invoices' কালেকশনে ইনভয়েস সেভ করা
        const result = await invoiceCollection.insertOne(invoiceData);
        const savedInvoiceId = result.insertedId;

        // ২. 'users' কালেকশনে ইনভয়েস রেফারেন্স পুশ করা
        if (invoiceData.clientEmail) {
            await usersCollection.updateOne(
                { email: invoiceData.clientEmail },
                { 
                    $push: { 
                        invoices: {
                            _id: savedInvoiceId, 
                            invoiceId: invoiceData.invoiceId,
                            projectTitle: invoiceData.projectTitle,
                            grandTotal: invoiceData.grandTotal,
                            status: invoiceData.status,
                            date: new Date()
                        } 
                    } 
                }
            );
        }

        res.status(201).send({ message: "✅ Invoice created & linked to user", result });
    } catch (err) {
        console.error("❌ Create Error:", err);
        res.status(500).send({ error: "Failed to create invoice" });
    }
});

/** 3️⃣ GET SINGLE INVOICE (By MongoDB _id) **/
router.get('/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const collection = database.collection("invoices");
        
        // ID valid কি না চেক করা
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

/** 4️⃣ SEND PROFESSIONAL EMAIL **/
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

/** 5️⃣ DOWNLOAD PDF **/
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
        doc.fontSize(10).text(`ID: ${inv.invoiceId}`, 50, 80);

        doc.fillColor('#333').fontSize(12).text('BILL TO:', 50, 150);
        doc.font('Helvetica').fontSize(11).text(inv.clientName, 50, 170);
        doc.text(inv.clientEmail, 50, 185);

        doc.end();
    } catch (err) {
        res.status(500).send({ error: "PDF Generation failed" });
    }
});

/** 6️⃣ PATCH (Update both collections) **/
router.patch('/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const invColl = database.collection("invoices");
        const userColl = database.collection("users");
        const query = ObjectId.isValid(req.params.id) ? { _id: new ObjectId(req.params.id) } : { invoiceId: req.params.id };
        
        // ১. ইনভয়েস আপডেট
        const updateDoc = { $set: { ...req.body, updatedAt: new Date() } };
        await invColl.updateOne(query, updateDoc);

        const updatedInv = await invColl.findOne(query);
        if (updatedInv) {
            await userColl.updateOne(
                { "invoices._id": updatedInv._id },
                { 
                    $set: { 
                        "invoices.$.status": updatedInv.status,
                        "invoices.$.grandTotal": updatedInv.grandTotal 
                    } 
                }
            );
        }

        res.send({ message: "✅ Updated successfully" });
    } catch { res.status(500).send({ error: "Update failed" }); }
});

/** 7️⃣ DELETE (Remove from both collections) **/
router.delete('/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const invColl = database.collection("invoices");
        const userColl = database.collection("users");
        const query = ObjectId.isValid(req.params.id) ? { _id: new ObjectId(req.params.id) } : { invoiceId: req.params.id };
        
        const invoiceToDelete = await invColl.findOne(query);

        if (invoiceToDelete) {
            
            await userColl.updateOne(
                { email: invoiceToDelete.clientEmail },
                { $pull: { invoices: { _id: invoiceToDelete._id } } }
            );
            
            await invColl.deleteOne({ _id: invoiceToDelete._id });
        }
        
        res.send({ message: "🗑️ Deleted from all records" });
    } catch { res.status(500).send({ error: "Delete failed" }); }
});

module.exports = router;