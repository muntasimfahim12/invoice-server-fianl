const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const { connectDB, transporter } = require('../config/db');

/** 1️⃣ GET ALL CLIENTS **/
router.get('/', async (req, res) => {
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
router.get('/:id', async (req, res) => {
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
router.post('/', async (req, res) => {
    try {
        const database = await connectDB();
        const clientsCollection = database.collection("clinets");
        const usersCollection = database.collection("users");

        const { name, email, portalEmail, password, projects, sendAutomationEmail } = req.body;

        const finalLoginEmail = (portalEmail || email).trim().toLowerCase();
        const finalPassword = password ? password.toString().trim() : "";

        const newClient = {
            ...req.body,
            portalEmail: finalLoginEmail,
            password: finalPassword,
            status: req.body.status || "Active",
            totalPaid: 0,
            createdAt: new Date(),
            projects: (projects || []).map(p => ({
                _id: new ObjectId().toString(),
                name: p.name,
                budget: Number(p.budget) || 0,
                description: p.description || "",
                type: p.type || "full",
                status: p.status || "Active",
                // মাইলস্টোন আইডি জেনারেট নিশ্চিত করা
                milestones: (p.milestones || []).map(m => ({
                    ...m,
                    _id: m._id || new ObjectId().toString(),
                    status: m.status || "pending"
                }))
            }))
        };

        const result = await clientsCollection.insertOne(newClient);
        const hashedPassword = await bcrypt.hash(finalPassword, 10);

        await usersCollection.insertOne({
            name: name,
            email: finalLoginEmail,
            password: hashedPassword,
            role: "client",
            clientId: result.insertedId,
            createdAt: new Date()
        });

        if (result.acknowledged && sendAutomationEmail) {
            const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
            const loginUrl = `${frontendUrl}/login?email=${finalLoginEmail}`;
            const emailHtml = `
                <div style="font-family: sans-serif; color: #333; line-height: 1.6; max-width: 600px;">
                  <p>Hello ${name},</p>
                  <p>Your project workspace is ready. Log in using the credentials below:</p>
                  <p><strong>Email:</strong> ${finalLoginEmail}<br><strong>Password:</strong> ${finalPassword}</p>
                  <p><a href="${loginUrl}" style="background-color: #4177BC; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Login to Dashboard</a></p>
                  <p>Best Regards,<br>Vault LedgerPRO Team</p>
                </div>`;

            await transporter.sendMail({
                from: `"Vault System" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: `Login Credentials for ${name}`,
                html: emailHtml
            });
        }

        res.status(201).send({ message: "✅ Client & User created successfully", result });
    } catch (err) {
        console.error("❌ Error creating client:", err);
        res.status(500).send({ error: "Failed to create client or user account" });
    }
});

/** 4️⃣ UPDATE CLIENT **/
router.put('/:id', async (req, res) => {
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
                milestones: (p.milestones || []).map(m => ({
                    ...m,
                    _id: m._id || new ObjectId().toString()
                }))
            }));
        }

        await collection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: updateData }
        );

        res.send({ message: "✅ Client updated" });
    } catch {
        res.status(500).send({ error: "Update failed" });
    }
});

/** 5️⃣ GET CLIENT BY EMAIL **/
router.get('/email/:email', async (req, res) => {
    try {
        const database = await connectDB();
        const clientData = await database.collection("clinets").findOne({ email: req.params.email });
        if (!clientData) return res.status(404).send({ error: "Client not found" });
        res.send(clientData);
    } catch (err) {
        res.status(500).send({ error: "Server error" });
    }
});

/** 6️⃣ UPDATE PROJECT STATUS ONLY **/
router.put('/:clientId/projects/:projectId', async (req, res) => {
    try {
        const { clientId, projectId } = req.params;
        const database = await connectDB();
        const result = await database.collection("clinets").updateOne(
            { _id: new ObjectId(clientId), "projects._id": projectId },
            { $set: { "projects.$.status": req.body.status } }
        );
        res.send({ message: "✅ Project status updated", status: req.body.status });
    } catch (err) {
        res.status(500).send({ message: "Update failed", error: err.message });
    }
});

/** 7️⃣ DELETE CLIENT & USER **/
router.delete('/:id', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id)) return res.status(400).send({ error: "Invalid ID" });
        const database = await connectDB();
        const objId = new ObjectId(req.params.id);
        await database.collection("users").deleteOne({ clientId: objId });
        await database.collection("clinets").deleteOne({ _id: objId });
        res.send({ message: "🗑️ Client and User deleted" });
    } catch {
        res.status(500).send({ error: "Delete failed" });
    }
});

/** 🚀 MASTER ROUTE: DEPLOY PROJECT & AUTO-INVOICE **/
router.post('/deploy-project', async (req, res) => {
    try {
        const database = await connectDB();
        const clientColl = database.collection("clinets");
        const invoiceColl = database.collection("invoices");
        const userColl = database.collection("users");

        const { clientId, title, totalBudget, milestones, paymentType, description } = req.body;

        const projectId = new ObjectId();
        const formattedMilestones = (milestones || []).map(m => ({
            ...m,
            _id: m._id || new ObjectId().toString(),
            status: m.status || "pending"
        }));

        const newProject = {
            _id: projectId.toString(),
            name: title,
            budget: Number(totalBudget),
            description: description || "",
            status: "Active",
            currentStep: 1,
            milestones: formattedMilestones,
            createdAt: new Date()
        };

        const clientUpdate = await clientColl.updateOne(
            { _id: new ObjectId(clientId) },
            { $push: { projects: newProject } }
        );

        if (clientUpdate.matchedCount === 0) return res.status(404).json({ error: "Client not found" });

        const client = await clientColl.findOne({ _id: new ObjectId(clientId) });
        const firstMilestone = (formattedMilestones.length > 0) ? formattedMilestones[0] : null;
        const invoiceAmount = paymentType === "Full Payment" ? Number(totalBudget) : Number(firstMilestone?.amount || 0);

        const invoiceData = {
            invoiceId: `INV-${Date.now().toString().slice(-6)}`,
            projectId: projectId.toString(),
            projectTitle: title,
            clientName: client.name,
            clientEmail: client.email,
            adminEmail: process.env.EMAIL_USER,
            grandTotal: invoiceAmount,
            remainingDue: invoiceAmount,
            status: "Unpaid",
            createdAt: new Date(),
            items: [{ name: firstMilestone?.name || "Initial Milestone", qty: 1, price: invoiceAmount }]
        };

        const invResult = await invoiceColl.insertOne(invoiceData);
        const summary = { _id: invResult.insertedId, invoiceId: invoiceData.invoiceId, status: "Unpaid", grandTotal: invoiceAmount, projectTitle: title };

        await userColl.updateOne({ email: client.email }, { $push: { invoicesReceived: summary } });
        await userColl.updateOne({ role: "admin" }, { $push: { myCreatedInvoices: summary } });

        const emailHtml = `
            <div style="font-family: sans-serif; max-width: 600px; border: 1px solid #eee; border-radius: 12px; overflow: hidden;">
                <div style="background-color: #4177BC; padding: 20px; color: white; text-align: center;"><h2>Project Started: ${title}</h2></div>
                <div style="padding: 20px;">
                    <p>Hello <b>${client.name}</b>,</p>
                    <p>Your new project has been initiated and the first invoice is ready.</p>
                    <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p><b>Amount Due:</b> USD ${invoiceAmount.toLocaleString()}</p>
                        <p><b>Invoice ID:</b> ${invoiceData.invoiceId}</p>
                    </div>
                    <a href="${process.env.FRONTEND_URL}/login" style="display: inline-block; background: #4177BC; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px;">View Dashboard & Pay</a>
                </div>
            </div>`;

        await transporter.sendMail({
            from: `"Vault System" <${process.env.EMAIL_USER}>`,
            to: client.email,
            subject: `New Project & Invoice: ${title}`,
            html: emailHtml
        });

        res.status(201).json({ success: true, message: "🚀 Deployed & Invoice Sent!", projectId });
    } catch (err) {
        res.status(500).json({ error: "Deployment failure" });
    }
});

/** 🎯 GET LOGGED-IN CLIENT PROFILE WITH 30-DAY STATEMENT **/
router.get('/profile/me', async (req, res) => {
    try {
        const userEmail = req.query.email;
        if (!userEmail) return res.status(400).send({ error: "Email is required" });

        const database = await connectDB();
        const clientData = await database.collection("clinets").findOne({
            $or: [{ email: userEmail }, { portalEmail: userEmail }]
        });

        if (!clientData) return res.status(404).send({ error: "Client not found" });

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        let statement = [];
        if (clientData.projects) {
            clientData.projects.forEach(project => {
                project.milestones.forEach(m => {
                    if (m.status === "Paid" && m.paidDate) {
                        const pDate = new Date(m.paidDate);
                        if (pDate >= thirtyDaysAgo) {
                            statement.push({
                                date: m.paidDate,
                                project: project.name,
                                description: m.name,
                                amount: m.amount,
                                method: m.paymentMethod || "N/A",
                                status: "Settled"
                            });
                        }
                    }
                });
            });
        }

        statement.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.send({ ...clientData, recentStatement: statement });
    } catch (err) {
        res.status(500).send({ error: "Server error" });
    }
});
/** 🎯 MASTER PAYMENT SYNC **/
router.put('/:id/payment', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            projectId,
            invoiceId,
            amount,
            method,
            date,
            clientEmail,
            clientName,
            projectName,
            milestoneName
        } = req.body;

        if (!projectId || !invoiceId || !id) {
            return res.status(400).json({ error: "Missing required tracking IDs." });
        }

        const database = await connectDB();
        const clientColl = database.collection("clinets");

        // আপডেট লজিক: Array Filters ব্যবহার করে নেস্টেড মাইলস্টোন আপডেট
        const result = await clientColl.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    "projects.$[proj].milestones.$[mile].status": "Paid",
                    "projects.$[proj].milestones.$[mile].paidDate": date || new Date().toISOString(),
                    "projects.$[proj].milestones.$[mile].paymentMethod": method
                },
                $inc: { totalPaid: Number(amount) || 0 }
            },
            {
                arrayFilters: [
                    { "proj._id": projectId },
                    { "mile._id": invoiceId }
                ]
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Sync failed. Client or Project not found." });
        }

        if (clientEmail) {
            const mailOptions = {
                from: `"Finance Dept | Vault System" <${process.env.EMAIL_USER}>`,
                to: clientEmail,
                subject: `Payment Receipt: ${milestoneName}`,
                html: `
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 24px; overflow: hidden; color: #1e293b;">
                        <div style="background-color: #4177BC; padding: 40px 20px; text-align: center; color: white;">
                            <h1 style="margin: 0; font-size: 24px;">Payment Confirmed</h1>
                            <p style="opacity: 0.8; margin-top: 8px;">Transaction ID: ${Math.random().toString(36).toUpperCase().substring(7)}</p>
                        </div>
                        <div style="padding: 40px 30px;">
                            <p style="font-size: 16px;">Hi <b>${clientName || 'Valued Client'}</b>,</p>
                            <p style="color: #64748b; line-height: 1.6;">Your payment for the milestone <b>${milestoneName}</b> has been successfully processed.</p>
                            <div style="background-color: #f8fafc; padding: 25px; border-radius: 16px; margin: 30px 0; border: 1px solid #f1f5f9;">
                                <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
                                    <tr> <td style="padding: 8px 0; color: #64748b;">Project</td> <td style="padding: 8px 0; text-align: right; font-weight: bold;">${projectName}</td> </tr>
                                    <tr> <td style="padding: 8px 0; color: #64748b;">Amount Paid</td> <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #10b981;">$${amount}</td> </tr>
                                    <tr> <td style="padding: 8px 0; color: #64748b;">Method</td> <td style="padding: 8px 0; text-align: right; font-weight: bold;">${method}</td> </tr>
                                </table>
                            </div>
                            <div style="text-align: center; margin-top: 40px;">
                                <a href="${process.env.FRONTEND_URL || '#'}" style="background-color: #1e293b; color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 14px;">View Dashboard</a>
                            </div>
                        </div>
                    </div>`
            };
            transporter.sendMail(mailOptions).catch(err => console.error("Email Error:", err));
        }

        res.status(200).json({ success: true, message: "✅ Payment synced successfully!" });
    } catch (err) {
        console.error("❌ MASTER SYNC ERROR:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;