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

/** 🚀 GET PROJECTS FOR A SINGLE CLIENT BY EMAIL (Logic: Admin Date Based) **/
router.get('/projects', async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) return res.status(400).send({ error: "Email is required" });

        const database = await connectDB();
        const client = await database.collection("clinets").findOne({ email });

        if (!client || !Array.isArray(client.projects)) return res.send([]);

        // Aajker date kora holo (Time 00:00:00) comparison-er jonno
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const projects = client.projects.map(project => {
            const processedMilestones = (project.milestones || []).map(m => {
                // Admin theke asha dueDate-ke Date object-e convert kora
                const milestoneDate = m.dueDate ? new Date(m.dueDate) : null;
                if(milestoneDate) milestoneDate.setHours(0, 0, 0, 0);

                const isPaid = m.isCompleted === true || m.isCompleted === "true" || m.status?.toLowerCase() === "paid";

                // MAIN LOGIC: Jodi paid na hoy EBONG (Admin date na dile open thakbe OR aajker date jodi milestone date-er shoman ba beshi hoy)
                const isDateReached = milestoneDate ? today.getTime() >= milestoneDate.getTime() : true;
                const isPayable = !isPaid && isDateReached;

                return {
                    ...m,
                    isPayable: isPayable, // Frontend eita use kore button enable korbe
                    isLocked: !isPaid && !isDateReached // Frontend eita use kore lock icon dekhabe
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

        const client = await database.collection("clinets").findOne({
            "projects._id": id
        });

        if (!client) return res.status(404).json({ error: "Project not found" });

        const project = client.projects.find(p => String(p._id) === String(id));

        // Auto Progress calculation logic
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

/** 💳 MILESTONE PAYMENT UPDATE API (Syncs Paid Amount) **/
router.patch('/update-milestone-status', async (req, res) => {
    try {
        const { projectId, milestoneIndex, isCompleted } = req.body;

        if (!projectId || milestoneIndex === undefined) {
            return res.status(400).json({ error: "Missing required data" });
        }

        const db = await connectDB();
        const clientsColl = db.collection("clinets");

        const updateQuery = {
            $set: {
                [`projects.$.milestones.${milestoneIndex}.isCompleted`]: isCompleted,
                [`projects.$.milestones.${milestoneIndex}.status`]: isCompleted ? "Paid" : "Pending"
            }
        };

        const result = await clientsColl.updateOne(
            { "projects._id": projectId },
            updateQuery
        );

        if (result.modifiedCount > 0 && isCompleted) {
            const updatedClient = await clientsColl.findOne({ "projects._id": projectId });
            const project = updatedClient.projects.find(p => String(p._id) === String(projectId));

            const totalPaid = project.milestones
                .filter(m => m.isCompleted === true || m.isCompleted === "true" || m.status === "Paid")
                .reduce((sum, m) => sum + Number(m.amount || 0), 0);

            await clientsColl.updateOne(
                { "projects._id": projectId },
                { $set: { "projects.$.paidAmount": totalPaid } }
            );
        }

        res.json({ success: true, message: "Milestone synchronized successfully!" });
    } catch (err) {
        res.status(500).json({ error: "Failed to update milestone" });
    }
});

module.exports = router;