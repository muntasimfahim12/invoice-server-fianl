const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { connectDB } = require('../config/db');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const Settings = require('../models/Settings');

const { generateGenieInvoicePDF } = require('./invoiceRoutes');

/** 📊 DASHBOARD STATS API **/
router.get('/dashboard-stats', async (req, res) => {
    try {
        const database = await connectDB();
        const clientsColl = database.collection("clinets");
        const invoiceColl = database.collection("invoices");

        const totalClients = await clientsColl.countDocuments();
        const allInvoices = await invoiceColl.find().toArray();

        // totalRevenue ও pendingAmount-এর জন্য ডাইনামিক ফিল্ড চেক
        const totalRevenue = allInvoices.reduce((sum, inv) => sum + (inv.amount || inv.receivedAmount || 0), 0);
        const pendingAmount = allInvoices.reduce((sum, inv) => sum + (inv.remainingDue || 0), 0);

        const clients = await clientsColl.find().toArray();
        let totalProjects = 0;
        clients.forEach(c => { if (c.projects) totalProjects += c.projects.length; });

        res.json({
            totalClients,
            totalProjects,
            totalRevenue,
            pendingAmount,
            recentInvoices: allInvoices.slice(-5).reverse() // শেষের ৫টি ইনভয়েস রিভার্স করে দেখানো
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

/** 🚀 GET PROJECTS FOR A SINGLE CLIENT BY EMAIL **/
router.get('/projects', async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) return res.status(400).send({ error: "Email is required" });

        const database = await connectDB();
        const client = await database.collection("clinets").findOne({ email: email.toLowerCase().trim() });

        if (!client || !Array.isArray(client.projects)) return res.send([]);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const projects = client.projects.map(project => {
            const processedMilestones = (project.milestones || []).map(m => {
                const milestoneDate = m.dueDate ? new Date(m.dueDate) : null;
                if (milestoneDate) milestoneDate.setHours(0, 0, 0, 0);

                const isPaid = m.isCompleted === true || m.isCompleted === "true" || m.status?.toLowerCase() === "paid";
                const isDateReached = milestoneDate ? today.getTime() >= milestoneDate.getTime() : true;
                const isPayable = !isPaid && isDateReached;

                return {
                    ...m,
                    isPayable: isPayable, 
                    isLocked: !isPaid && !isDateReached 
                };
            });

            return {
                _id: project._id,
                title: project.name,
                projectName: project.name,
                description: project.description,
                budget: project.budget,
                paidAmount: project.paidAmount || 0,
                status: project.status || "Active",
                milestones: processedMilestones,
                clientName: client.name,
                clientId: client._id
            };
        });

        res.send(projects.reverse());
    } catch (err) {
        console.error("Project Fetch Error:", err);
        res.status(500).send({ error: "Failed to fetch client projects" });
    }
});

/** 🔍 GET SINGLE PROJECT DETAILS BY ID **/
router.get('/project-details/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const database = await connectDB();

        const client = await database.collection("clinets").findOne({ "projects._id": id });
        if (!client) return res.status(404).json({ error: "Project not found" });

        const project = client.projects.find(p => String(p._id) === String(id));

        let calculatedProgress = 0;
        if (project.milestones && project.milestones.length > 0) {
            const paidMilestones = project.milestones.filter(
                m => m.status && m.status.toLowerCase() === 'paid'
            ).length;
            calculatedProgress = Math.round((paidMilestones / project.milestones.length) * 100);
        } else {
            calculatedProgress = project.progress || 0;
        }

        res.json({
            ...project,
            progress: calculatedProgress,
            clientName: client.name,
            clientEmail: client.email
        });
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

/** 👤 ADMIN MANAGEMENT: ADD NEW ADMIN **/
router.post('/manage-admins', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Email and Password required" });

        const db = await connectDB();
        const usersColl = db.collection("users");

        const existingUser = await usersColl.findOne({ email: email.toLowerCase().trim() });
        if (existingUser) return res.status(400).json({ error: "Admin already exists!" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newAdmin = {
            name,
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role: role || "admin",
            createdAt: new Date()
        };

        await usersColl.insertOne(newAdmin);
        res.json({ success: true, message: "New Admin Created Successfully!" });
    } catch (err) {
        res.status(500).json({ error: "Failed to create admin" });
    }
});

/** ⚙️ GLOBAL SETTINGS: FETCH & UPDATE **/
router.get('/settings', async (req, res) => {
    try {
        let settings = await Settings.findOne({});
        if (!settings) {
            return res.json({
                businessName: "My Agency",
                invPrefix: "INV-",
                currency: "USD",
                taxRate: 0
            });
        }
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: "Error fetching system settings" });
    }
});

router.post('/settings', async (req, res) => {
    try {
        const data = req.body;
        if (data._id) delete data._id;

        const updatedSettings = await Settings.findOneAndUpdate(
            {},
            { $set: { ...data, lastUpdated: new Date() } },
            { new: true, upsert: true }
        );

        res.json({ success: true, message: "System Architecture Updated!", settings: updatedSettings });
    } catch (err) {
        res.status(500).json({ error: "Global sync failed" });
    }
});

/** 💳 MILESTONE PAYMENT UPDATE & AUTO-EMAIL **/
router.patch('/update-milestone-status', async (req, res) => {
    try {
        const { projectId, milestoneIndex, isCompleted, paymentMethod, amount } = req.body;

        if (!projectId || milestoneIndex === undefined) {
            return res.status(400).json({ error: "Missing projectId or milestoneIndex" });
        }

        const db = await connectDB();
        const clientsColl = db.collection("clinets");
        const invoiceColl = db.collection("invoices");

        // ১. গ্লোবাল সেটিংস ফেচ করা (Invoice Prefix & Currency এর জন্য)
        const globalSettings = await Settings.findOne({}) || { invPrefix: "INV-", currency: "USD", businessName: "Agency" };

        const client = await clientsColl.findOne({ "projects._id": projectId });
        if (!client) return res.status(404).json({ error: "Client/Project not found" });

        const project = client.projects.find(p => String(p._id) === String(projectId));
        const milestone = project.milestones[milestoneIndex];
        const status = isCompleted ? "Paid" : "Unpaid";
        const paymentValue = Number(amount || milestone.amount);

        // ২. ডাটাবেস আপডেট
        const updateDoc = {
            $set: {
                [`projects.$.milestones.${milestoneIndex}.isCompleted`]: isCompleted,
                [`projects.$.milestones.${milestoneIndex}.status`]: status,
                [`projects.$.milestones.${milestoneIndex}.paymentDate`]: isCompleted ? new Date() : null,
                [`projects.$.milestones.${milestoneIndex}.method`]: paymentMethod || "Online Payment"
            }
        };

        if (isCompleted) {
            updateDoc.$inc = { totalPaid: paymentValue };
        }

        const updateResult = await clientsColl.updateOne(
            { "projects._id": projectId },
            updateDoc
        );

        // ৩. ইনভয়েস ও ইমেইল লজিক
        if (isCompleted && updateResult.matchedCount > 0) {
            const invoiceId = `${globalSettings.invPrefix}${Date.now().toString().slice(-6)}`;

            const invoiceData = {
                invoiceId,
                projectId,
                milestoneId: milestone._id || `M-${milestoneIndex}`,
                projectTitle: project.name,
                clientName: client.name,
                clientEmail: client.email.toLowerCase().trim(),
                amount: paymentValue,
                currency: globalSettings.currency, // সেটিংস থেকে ডাইনামিক কারেন্সি
                method: paymentMethod || "Online Payment",
                status: "Paid",
                paymentDate: new Date(),
                milestonesSnapshot: project.milestones.map((m, idx) =>
                    idx === milestoneIndex ? { ...m, status: "Paid", isCompleted: true } : m
                ),
                createdAt: new Date(),
                businessName: globalSettings.businessName // সেটিংস থেকে বিজনেস নেম
            };

            await invoiceColl.insertOne(invoiceData);

            // ৪. PDF ও Email প্রসেস
            const doc = new PDFDocument({ size: 'A4', margin: 50 });
            let buffers = [];
            doc.on('data', chunk => buffers.push(chunk));
            doc.on('end', async () => {
                const pdfBuffer = Buffer.concat(buffers);

                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        user: process.env.EMAIL_USER,
                        pass: process.env.EMAIL_PASS
                    }
                });

                const mailOptions = {
                    from: `"${globalSettings.businessName}" <${process.env.EMAIL_USER}>`,
                    to: invoiceData.clientEmail,
                    subject: `Payment Received: Invoice #${invoiceId}`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; border: 1px solid #eee; padding: 20px;">
                            <h2 style="color: #2ecc71;">Payment Successful!</h2>
                            <p>Hi <b>${client.name}</b>,</p>
                            <p>We've received your payment for <b>${milestone.name}</b>.</p>
                            <table style="width: 100%; background: #f9f9f9; padding: 10px;">
                                <tr><td>Amount Paid:</td><td><b>${paymentValue} ${globalSettings.currency}</b></td></tr>
                                <tr><td>Invoice ID:</td><td>#${invoiceId}</td></tr>
                                <tr><td>Method:</td><td>${invoiceData.method}</td></tr>
                            </table>
                            <p>Your official invoice is attached to this email.</p>
                            <p>Thanks for working with <b>${globalSettings.businessName}</b>!</p>
                        </div>
                    `,
                    attachments: [{ filename: `${invoiceId}.pdf`, content: pdfBuffer }]
                };

                try {
                    await transporter.sendMail(mailOptions);
                } catch (emailErr) {
                    console.error("Email Error:", emailErr);
                }
            });

            if (typeof generateGenieInvoicePDF === 'function') {
                generateGenieInvoicePDF({ ...invoiceData, settings: globalSettings }, doc);
            } else {
                doc.fontSize(25).text('INVOICE', { align: 'center' });
                doc.fontSize(12).text(`Invoice ID: ${invoiceId}`, 50, 100);
                doc.text(`Project: ${project.name}`);
                doc.text(`Amount: ${paymentValue} ${globalSettings.currency}`);
                doc.end();
            }

            return res.json({
                success: true,
                message: "Database updated, invoice saved, and email sent.",
                invoiceId
            });
        }

        res.json({ success: true, message: "Status updated successfully" });

    } catch (err) {
        console.error("Critical Sync Error:", err);
        res.status(500).json({ error: "System failed to sync payment" });
    }
});

module.exports = router;