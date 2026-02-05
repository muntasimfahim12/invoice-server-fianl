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

/** 3️⃣ CREATE CLIENT (Saves to both 'clinets' and 'users' collections) **/
router.post('/', async (req, res) => {
    try {
        const database = await connectDB();
        const clientsCollection = database.collection("clinets");
        const usersCollection = database.collection("users");

        const {
            name,
            email,
            portalEmail,
            password,
            projects,
            sendAutomationEmail
        } = req.body;

        const finalLoginEmail = (portalEmail || email).trim().toLowerCase();
        const finalPassword = password ? password.toString().trim() : "";

        const newClient = {
            ...req.body,
            portalEmail: finalLoginEmail,
            password: finalPassword, 
            status: req.body.status || "Active",
            createdAt: new Date(),
            projects: (projects || []).map(p => ({
                _id: new ObjectId().toString(),
                name: p.name,
                budget: Number(p.budget) || 0,
                description: p.description || "",
                type: p.type || "full",
                status: p.status || "Active",
                milestones: p.milestones || []
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

            const simpleEmailHtml = `
                <div style="font-family: sans-serif; color: #333; line-height: 1.6; max-width: 600px;">
                  <p>Hello ${name},</p>
                  <p>Your project workspace is ready. Log in using the credentials below:</p>
                  <p>
                    <strong>Email:</strong> ${finalLoginEmail}<br>
                    <strong>Password:</strong> ${finalPassword}
                  </p>
                  <p><a href="${loginUrl}" style="background-color: #4177BC; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Login to Dashboard</a></p>
                  <p>Best Regards,<br>Vault LedgerPRO Team</p>
                </div>
            `;

            await transporter.sendMail({
                from: `"Vault System" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: `Login Credentials for ${name}`,
                html: simpleEmailHtml
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
                milestones: p.milestones || []
            }));
        }

        const result = await collection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: updateData }
        );

        res.send({ message: "✅ Client updated" });
    } catch {
        res.status(500).send({ error: "Update failed" });
    }
});

/** 7️⃣ GET CLIENT BY EMAIL (For Invoice Auto-fill) **/
router.get('/email/:email', async (req, res) => {
    try {
        const email = req.params.email;
        const database = await connectDB();

        
        const collection = database.collection("clinets");

        const clientData = await collection.findOne({ email: email });

        if (!clientData) {
            return res.status(404).send({ error: "Client not found with this email" });
        }

        res.send(clientData);
    } catch (err) {
        console.error("❌ Error fetching client by email:", err);
        res.status(500).send({ error: "Server error" });
    }
});

/** 5️⃣ UPDATE PROJECT STATUS **/
router.put('/:clientId/projects/:projectId', async (req, res) => {
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

        res.send({ message: "✅ Project status updated", status });
    } catch (err) {
        res.status(500).send({ message: "Update failed", error: err.message });
    }
});

/** 6️⃣ DELETE CLIENT (Should also delete from users) **/
router.delete('/:id', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id))
            return res.status(400).send({ error: "Invalid ID" });

        const database = await connectDB();

        await database.collection("users").deleteOne({ clientId: new ObjectId(req.params.id) });
        const result = await database.collection("clinets").deleteOne({ _id: new ObjectId(req.params.id) });

        res.send({ message: "🗑️ Client and User deleted" });
    } catch {
        res.status(500).send({ error: "Delete failed" });
    }
});

module.exports = router;