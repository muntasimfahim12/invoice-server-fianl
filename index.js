const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// --- Middleware ---
app.use(cors());
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
  await client.connect();
  db = client.db("invoice");
  console.log("✅ MongoDB Connected");
  return db;
}

// --- Root ---
app.get('/', (req, res) => {
  res.send('🚀 Vault Server Running');
});

/**
 * 1️⃣ GET ALL CLIENTS
 */
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

/**
 * 2️⃣ GET SINGLE CLIENT
 */
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

/**
 * 3️⃣ CREATE CLIENT (AUTO PROJECT ID)
 */
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

/**
 * 4️⃣ UPDATE CLIENT (SAFE PROJECT HANDLING)
 */
app.put('/clinets/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).send({ error: "Invalid ID" });

    const database = await connectDB();
    const collection = database.collection("clinets");

    const { _id, projects, ...rest } = req.body;

    const updateData = {
      ...rest,
      updatedAt: new Date()
    };

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

/**
 * 5️⃣ UPDATE SINGLE PROJECT STATUS (FIXED)
 */
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
      {
        $set: { "projects.$.status": status }
      }
    );

    if (!result.matchedCount)
      return res.status(404).send({ message: "Project not found" });

    res.send({ message: "✅ Project status updated", status });
  } catch (err) {
    res.status(500).send({ message: "Update failed", error: err.message });
  }
});

/**
 * 6️⃣ DELETE CLIENT
 */
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

// --- START SERVER ---
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});

module.exports = app;
