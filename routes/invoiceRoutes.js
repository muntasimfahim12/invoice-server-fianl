const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const multer = require('multer');
const { connectDB } = require('../config/db');

const upload = multer({ storage: multer.memoryStorage() });

// ইমেইল ট্রান্সপোর্টার কনফিগারেশন
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

/** * HELPER FUNCTION: Professional PDF Generator (Genie Hack Style)
 */
const generateGenieInvoicePDF = (data, stream) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(stream);

    doc.fillColor('#0F172A').fontSize(22).text('GENIE HACK', 50, 50, { stroke: true });
    doc.fontSize(10).fillColor('#64748B').text('Cyber Security & Digital Solutions', 50, 75);

    doc.fillColor('#4177BC').fontSize(28).text('INVOICE', 400, 45, { align: 'right' });
    doc.fontSize(10).fillColor('#000').text(`ID: #${data.invoiceId}`, 400, 80, { align: 'right' });
    doc.text(`Date: ${new Date(data.createdAt || Date.now()).toLocaleDateString()}`, 400, 95, { align: 'right' });

    doc.moveTo(50, 120).lineTo(550, 120).lineWidth(2).strokeColor('#4177BC').stroke();

    doc.moveDown(2);
    const topOfInfo = 140;

    doc.fillColor('#4177BC').fontSize(10).text('FROM:', 50, topOfInfo);
    doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text('Genie Hack Ltd.', 50, topOfInfo + 15);
    doc.fontSize(9).font('Helvetica').fillColor('#64748B').text(data.freelancerAddress || 'Dhaka, Bangladesh', 50, topOfInfo + 30);

    doc.fillColor('#4177BC').fontSize(10).text('BILL TO:', 350, topOfInfo);
    doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text(data.clientName, 350, topOfInfo + 15);
    doc.fontSize(9).font('Helvetica').fillColor('#64748B').text(data.clientEmail, 350, topOfInfo + 30);


    const tableTop = 230;
    doc.rect(50, tableTop, 500, 25).fill('#4177BC');
    doc.fillColor('#FFF').fontSize(10).text('Description', 60, tableTop + 8);
    doc.text('Qty', 300, tableTop + 8);
    doc.text('Price', 380, tableTop + 8);
    doc.text('Total', 480, tableTop + 8);


    let i = 0;
    const items = data.items || [{ name: data.projectTitle, qty: 1, price: data.grandTotal }];
    items.forEach((item, index) => {
        const y = tableTop + 25 + (index * 25);
        if (index % 2 === 0) doc.rect(50, y, 500, 25).fill('#F8FAFC');
        doc.fillColor('#000').font('Helvetica').text(item.name, 60, y + 8);
        doc.text(item.qty.toString(), 300, y + 8);
        doc.text(`${data.currency || '$'} ${Number(item.price).toLocaleString()}`, 380, y + 8);
        doc.text(`${data.currency || '$'} ${(item.qty * item.price).toLocaleString()}`, 480, y + 8);
        i++;
    });


    const subtotalY = tableTop + 25 + (i * 25) + 30;
    doc.rect(350, subtotalY, 200, 35).fill('#4177BC');
    doc.fillColor('#FFF').fontSize(12).font('Helvetica-Bold').text('GRAND TOTAL', 360, subtotalY + 12);
    doc.text(`${data.currency || '$'} ${Number(data.grandTotal).toLocaleString()}`, 450, subtotalY + 12, { align: 'right', width: 90 });

    doc.fontSize(8).fillColor('#94A3B8').text('Thank you for choosing Genie Hack. This is a computer-generated invoice.', 50, 780, { align: 'center', width: 500 });
    doc.end();
};

/** 1️⃣ GET INVOICES **/
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
    } catch (err) { res.status(500).send({ error: "Failed to fetch invoices" }); }
});

/** 2️⃣ CREATE INVOICE (With Global Dashboard Sync) **/
router.post('/', async (req, res) => {
    try {
        const database = await connectDB();
        const invoiceCollection = database.collection("invoices");
        const usersCollection = database.collection("users");
        const { adminEmail, clientEmail, ...rest } = req.body;

        const invoiceData = {
            ...rest,
            adminEmail: adminEmail.toLowerCase(),
            clientEmail: clientEmail.toLowerCase(),
            createdAt: new Date(),
            updatedAt: new Date(),
            status: req.body.status || "Unpaid"
        };

        const result = await invoiceCollection.insertOne(invoiceData);
        const summaryData = {
            _id: result.insertedId,
            invoiceId: invoiceData.invoiceId,
            projectTitle: invoiceData.projectTitle,
            clientName: invoiceData.clientName,
            grandTotal: invoiceData.grandTotal,
            status: invoiceData.status,
            date: invoiceData.createdAt
        };

        await usersCollection.updateOne({ email: invoiceData.adminEmail }, { $push: { myCreatedInvoices: summaryData } });
        await usersCollection.updateOne({ email: invoiceData.clientEmail }, { $push: { invoicesReceived: summaryData } });

        res.status(201).send({ message: "✅ Invoice created & synced", id: result.insertedId });
    } catch (err) { res.status(500).send({ error: "Failed to create invoice" }); }
});

/** 3️⃣ GET SINGLE INVOICE **/
router.get('/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const query = ObjectId.isValid(req.params.id) ? { _id: new ObjectId(req.params.id) } : { invoiceId: req.params.id };
        const inv = await database.collection("invoices").findOne(query);
        inv ? res.send(inv) : res.status(404).send({ error: "Not found" });
    } catch (err) { res.status(500).send({ error: "Internal error" }); }
});

/** 4️⃣ SEND EMAIL (Professional PDF Attachment) **/
router.post('/send-email', upload.single('pdf'), async (req, res) => {
    try {
        const database = await connectDB();
        const invColl = database.collection("invoices");
        const userColl = database.collection("users");
        const settingsColl = database.collection("settings");

        const inv = req.file ? JSON.parse(req.body.invoiceData) : req.body;


        const siteSettings = await settingsColl.findOne({});
        const userProvidedLink = siteSettings?.paypalLink || inv.paypalEmail || process.env.PAYPAL_EMAIL || "";
        let finalPaymentLink = userProvidedLink;

        if (userProvidedLink.includes('@')) {
            finalPaymentLink = `https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=${userProvidedLink}&amount=${inv.remainingDue}&currency_code=${inv.currency}&item_name=Invoice_${inv.invoiceId}`;
        }

        // PDF তৈরি
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfBuffer = Buffer.concat(buffers);

            await transporter.sendMail({
                from: `"Genie Hack Billing" <${process.env.EMAIL_USER}>`,
                to: inv.clientEmail,
                subject: `Invoice #${inv.invoiceId} from Genie Hack`,
                html: `<div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                        <h2 style="color: #4177BC;">Hello ${inv.clientName},</h2>
                        <p>Your invoice <b>#${inv.invoiceId}</b> from <b>Genie Hack</b> is ready.</p>
                        <p>Total Amount: <b>${inv.currency} ${inv.grandTotal}</b></p>
                        <a href="${finalPaymentLink}" style="background:#4177BC; color:white; padding:10px 20px; text-decoration:none; border-radius:5px;">Pay Now</a>
                        <p>Regards,<br/><b>Genie Hack Team</b></p>
                      </div>`,
                attachments: [{ filename: `Invoice_${inv.invoiceId}.pdf`, content: pdfBuffer }]
            });

            // Status Update
            await invColl.updateOne({ invoiceId: inv.invoiceId }, { $set: { status: "Sent", updatedAt: new Date() } });
            await userColl.updateOne({ email: inv.adminEmail, "myCreatedInvoices.invoiceId": inv.invoiceId }, { $set: { "myCreatedInvoices.$.status": "Sent" } });
            await userColl.updateOne({ email: inv.clientEmail, "invoicesReceived.invoiceId": inv.invoiceId }, { $set: { "invoicesReceived.$.status": "Sent" } });

            res.status(200).json({ success: true, message: "✅ Email Sent with Genie Hack Styling!" });
        });

        generateGenieInvoicePDF(inv, doc);
    } catch (err) { res.status(500).json({ error: "Failed to send email" }); }
});

/** 5️⃣ DOWNLOAD PDF **/
router.get('/:id/download', async (req, res) => {
    try {
        const database = await connectDB();
        const query = ObjectId.isValid(req.params.id) ? { _id: new ObjectId(req.params.id) } : { invoiceId: req.params.id };
        const inv = await database.collection("invoices").findOne(query);
        if (!inv) return res.status(404).send({ error: "Invoice not found" });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Invoice-${inv.invoiceId}.pdf`);
        generateGenieInvoicePDF(inv, res);
    } catch (err) { res.status(500).send({ error: "PDF Generation error" }); }
});

/** 6️⃣ PATCH (Global Update) **/
router.patch('/:id', async (req, res) => {
    try {
        const database = await connectDB();
        const invoiceColl = database.collection("invoices");
        const userColl = database.collection("users");
        const invoiceObjectId = ObjectId.isValid(req.params.id) ? new ObjectId(req.params.id) : null;

        const { _id, createdAt, ...updateFields } = req.body;
        await invoiceColl.updateOne({ _id: invoiceObjectId }, { $set: { ...updateFields, updatedAt: new Date() } });

        const updated = await invoiceColl.findOne({ _id: invoiceObjectId });
        if (updated) {
            await userColl.updateOne({ email: updated.adminEmail, "myCreatedInvoices._id": updated._id }, { $set: { "myCreatedInvoices.$.status": updated.status, "myCreatedInvoices.$.grandTotal": updated.grandTotal, "myCreatedInvoices.$.projectTitle": updated.projectTitle } });
            await userColl.updateOne({ email: updated.clientEmail, "invoicesReceived._id": updated._id }, { $set: { "invoicesReceived.$.status": updated.status, "invoicesReceived.$.grandTotal": updated.grandTotal } });
        }
        res.send({ message: "✅ Global update successful" });
    } catch (err) { res.status(500).send({ error: "Update failed" }); }
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

/** 8️⃣ BULK DELETE **/
router.post('/bulk-delete', async (req, res) => {
    try {
        const { ids } = req.body;
        const database = await connectDB();
        const invoiceColl = database.collection("invoices");
        const userColl = database.collection("users");

        const objectIds = ids.map(id => new ObjectId(id));
        const invoicesToDelete = await invoiceColl.find({ _id: { $in: objectIds } }).toArray();

        for (const inv of invoicesToDelete) {
            await userColl.updateOne({ email: inv.adminEmail }, { $pull: { myCreatedInvoices: { _id: inv._id } } });
            await userColl.updateOne({ email: inv.clientEmail }, { $pull: { invoicesReceived: { _id: inv._id } } });
        }
        await invoiceColl.deleteMany({ _id: { $in: objectIds } });
        res.status(200).send({ message: "🗑️ Bulk deleted globally" });
    } catch (err) { res.status(500).send({ error: "Bulk delete failed" }); }
});

/** 🔄 UPDATE STATUS & MILESTONE AUTO-SYNC **/
router.put('/update-status/:invoiceId', async (req, res) => {
    try {
        const { status } = req.body;
        const database = await connectDB();
        const invoiceColl = database.collection("invoices");
        const clientColl = database.collection("clinets");
        const userColl = database.collection("users");

        const currentInvoice = await invoiceColl.findOneAndUpdate(
            { invoiceId: req.params.invoiceId },
            { $set: { status: status, updatedAt: new Date() } },
            { returnDocument: 'after' }
        );

        if (!currentInvoice) return res.status(404).send({ error: "Invoice not found" });


        await userColl.updateOne({ email: currentInvoice.adminEmail, "myCreatedInvoices.invoiceId": currentInvoice.invoiceId }, { $set: { "myCreatedInvoices.$.status": status } });
        await userColl.updateOne({ email: currentInvoice.clientEmail, "invoicesReceived.invoiceId": currentInvoice.invoiceId }, { $set: { "invoicesReceived.$.status": status } });


        if (status === "Paid" && currentInvoice.projectId) {
            const projId = new ObjectId(currentInvoice.projectId);
            const client = await clientColl.findOne({ "projects._id": projId });
            const project = client?.projects.find(p => p._id.toString() === projId.toString());

            if (project) {
                const alreadyPaid = Number(project.paidAmount || 0) + Number(currentInvoice.grandTotal || 0);
                const nextStep = (project.currentStep || 1) + 1;
                const nextMilestone = project.milestones[nextStep - 1];

                if (nextMilestone) {
                    const nextInvoiceData = {
                        invoiceId: `INV-${Date.now().toString().slice(-6)}`,
                        projectId: project._id,
                        projectTitle: project.name,
                        clientName: client.name,
                        clientEmail: client.email.toLowerCase(),
                        adminEmail: currentInvoice.adminEmail.toLowerCase(),
                        grandTotal: Number(nextMilestone.amount),
                        currency: currentInvoice.currency || "$",
                        status: "Unpaid",
                        createdAt: new Date()
                    };
                    const savedNext = await invoiceColl.insertOne(nextInvoiceData);
                    const summary = { _id: savedNext.insertedId, invoiceId: nextInvoiceData.invoiceId, projectTitle: nextInvoiceData.projectTitle, clientName: nextInvoiceData.clientName, grandTotal: nextInvoiceData.grandTotal, status: "Unpaid", date: new Date() };

                    await userColl.updateOne({ email: nextInvoiceData.adminEmail }, { $push: { myCreatedInvoices: summary } });
                    await userColl.updateOne({ email: nextInvoiceData.clientEmail }, { $push: { invoicesReceived: summary } });
                    await clientColl.updateOne({ "projects._id": project._id }, { $set: { "projects.$.currentStep": nextStep, "projects.$.paidAmount": alreadyPaid } });
                } else {
                    await clientColl.updateOne({ "projects._id": project._id }, { $set: { "projects.$.status": "Completed", "projects.$.progress": 100, "projects.$.paidAmount": alreadyPaid } });
                }
            }
        }
        res.json({ success: true, message: "System Synced Successfully!" });
    } catch (err) { res.status(500).json({ error: "Sync failed" }); }
});

/** 💳 PROCESS FINAL PAYMENT **/
router.post('/process-final-payment', async (req, res) => {
    try {
        const { clientId, projectId, milestoneId, invoiceId, paymentAmount, paymentMethod } = req.body;
        const database = await connectDB();
        const invoiceColl = database.collection("invoices");

        const updatedInvoice = await invoiceColl.findOneAndUpdate(
            { invoiceId: invoiceId },
            { $set: { status: 'Paid', receivedAmount: paymentAmount, remainingDue: 0, updatedAt: new Date() } },
            { returnDocument: 'after' }
        );

        if (!updatedInvoice) return res.status(404).json({ error: "Invoice not found" });

        await database.collection("clinets").updateOne(
            { _id: new ObjectId(clientId) },
            {
                $set: {
                    "projects.$[proj].milestones.$[mile].status": "Paid",
                    "projects.$[proj].milestones.$[mile].isCompleted": true
                },
                $inc: { totalPaid: Number(paymentAmount) }
            },
            { arrayFilters: [{ "proj._id": projectId }, { "mile._id": milestoneId }] }
        );

        res.json({ success: true, message: "Final Payment Processed Successfully!" });
    } catch (err) { res.status(500).json({ error: "Final integration failed" }); }
});

module.exports = router;