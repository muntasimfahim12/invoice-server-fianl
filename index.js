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

// Database Connection Caching
let db;

async function connectDB() {
  if (db) return db;
  try {
    await client.connect();
    db = client.db("invoice");
    console.log("✅ MongoDB Connected Successfully!");
    return db;
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    throw err;
  }
}

// --- Routes ---

app.get('/', (req, res) => {
  res.send('🚀 Vault Server is running successfully with Advanced Features!');
});

/**
 * 1. GET ALL CLIENTS (With Search and Filter)
 * আপনি এখান থেকে সরাসরি সার্চ করতে পারবেন: /clinets?search=Name
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
    if (status && status !== 'All') {
      query.status = status;
    }

    // নতুন ক্লায়েন্ট আগে দেখাবে (Sorting)
    const clients = await collection.find(query).sort({ createdAt: -1 }).toArray();
    res.send(clients);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch clients" });
  }
});

/**
 * 2. GET SINGLE CLIENT
 */
app.get('/clinets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid Object ID" });

    const database = await connectDB();
    const collection = database.collection("clinets");
    const clientData = await collection.findOne({ _id: new ObjectId(id) });
    
    if (!clientData) return res.status(404).send({ error: "Client not found" });
    res.send(clientData);
  } catch (err) {
    res.status(500).send({ error: "Server Error" });
  }
});

/**
 * 3. POST - CREATE NEW CLIENT
 */
app.post('/clinets', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection("clinets");
    
    const newClient = {
      ...req.body,
      createdAt: new Date(), // অটোমেটিক সময় যোগ হবে
      status: req.body.status || "Active",
      activeProjects: req.body.projects?.length || 0
    };

    const result = await collection.insertOne(newClient);
    res.status(201).send({
        ...result,
        insertedData: newClient
    });
  } catch (err) {
    res.status(500).send({ error: "Failed to add client" });
  }
});

/**
 * 4. PUT - UPDATE CLIENT DATA
 */
app.put('/clinets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid ID" });

    const database = await connectDB();
    const collection = database.collection("clinets");
    
    // _id রিমুভ করা হচ্ছে যাতে আপডেট করার সময় কনফ্লিক্ট না হয়
    const { _id, ...updateData } = req.body;
    updateData.updatedAt = new Date();

    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) return res.status(404).send({ error: "Client not found" });
    res.send({ message: "Updated successfully", result });
  } catch (err) {
    res.status(500).send({ error: "Failed to update" });
  }
});

/**
 * 5. DELETE - REMOVE CLIENT
 */
app.delete('/clinets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid ID format" });

    const database = await connectDB();
    const collection = database.collection("clinets");
    const result = await collection.deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 0) return res.status(404).send({ error: "Client not found" });
    res.send({ message: "Client record deleted", result });
  } catch (err) {
    res.status(500).send({ error: "Failed to delete" });
  }
});

// --- Server Start ---
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
  });
}

module.exports = app;