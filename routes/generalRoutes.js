const express = require('express');
const router = express.Router();
const { connectDB } = require('../config/db');
const bcrypt = require('bcryptjs');

/** 📊 DASHBOARD STATS API **/
router.get('/dashboard-stats', async (req, res) => {
    try {
        const database = await connectDB();
        const clientsColl = database.collection("clinets");
        const invoiceColl = database.collection("invoices");

        const totalClients = await clientsColl.countDocuments();
        const allInvoices = await invoiceColl.find().toArray();

        const totalRevenue = allInvoices.reduce((sum, inv) => sum + (inv.receivedAmount || 0), 0);
        const pendingAmount = allInvoices.reduce((sum, inv) => sum + (inv.remainingDue || 0), 0);

        const clients = await clientsColl.find().toArray();
        let totalProjects = 0;
        clients.forEach(c => { if (c.projects) totalProjects += c.projects.length; });

        res.json({
            totalClients,
            totalProjects,
            totalRevenue,
            pendingAmount,
            recentInvoices: allInvoices.slice(0, 5)
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
        const client = await database.collection("clinets").findOne({ email });

        if (!client || !Array.isArray(client.projects)) return res.send([]);

        const projects = client.projects.map(project => ({
            _id: project._id,
            title: project.name,
            description: project.description,
            budget: project.budget,
            status: project.status || "Active",
            deadline: project.deadline || "Not Set",
            progress: project.progress || 0,
            clientName: client.name,
            clientId: client._id
        }));

        res.send(projects.reverse());
    } catch (err) {
        res.status(500).send({ error: "Failed to fetch client projects" });
    }
});

/** 👤 ADMIN MANAGEMENT: ADD NEW ADMIN **/
router.post('/manage-admins', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Email and Password required" });

        const db = await connectDB();
        const usersColl = db.collection("users");

        const existingUser = await usersColl.findOne({ email });
        if (existingUser) return res.status(400).json({ error: "Admin already exists!" });

        const hashedPassword = await bcrypt.hash(password, 10);

        const newAdmin = {
            name,
            email,
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
        const db = await connectDB();
        const settings = await db.collection("settings").findOne({ id: "admin_config" });
        res.json(settings || {});
    } catch (err) { res.status(500).json({ error: "Error fetching settings" }); }
});

router.post('/settings', async (req, res) => {
    try {
        const db = await connectDB();
        const data = req.body;
        delete data._id; 

        await db.collection("settings").updateOne(
            { id: "admin_config" },
            { $set: { ...data, lastUpdated: new Date() } },
            { upsert: true }
        );
        res.json({ success: true, message: "System Synced Globally!" });
    } catch (err) { res.status(500).json({ error: "Failed to save settings" }); }
});

module.exports = router;