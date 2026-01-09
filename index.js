const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Database Connection Caching (ভিআরসেলের পারফরম্যান্সের জন্য জরুরি)
let db;

async function connectDB() {
  if (db) return db; // যদি আগে কানেক্ট থাকে তবে সেটাই ব্যবহার করবে
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

// Routes
app.get('/', (req, res) => {
  res.send('🚀 Vault Server is running successfully!');
});

app.get('/clinets', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection("clinets");
    const clients = await collection.find().toArray();
    res.send(clients);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch clients" });
  }
});

app.get('/clinets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const database = await connectDB();
    const collection = database.collection("clinets");
    const clientData = await collection.findOne({ _id: new ObjectId(id) });
    
    if (!clientData) return res.status(404).send({ error: "Client not found" });
    res.send(clientData);
  } catch (err) {
    res.status(500).send({ error: "Invalid ID format" });
  }
});

app.post('/clinets', async (req, res) => {
  try {
    const database = await connectDB();
    const collection = database.collection("clinets");
    const result = await collection.insertOne(req.body);
    res.status(201).send(result);
  } catch (err) {
    res.status(500).send({ error: "Failed to add client" });
  }
});

app.put('/clinets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const database = await connectDB();
    const collection = database.collection("clinets");
    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: req.body }
    );
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Failed to update" });
  }
});

app.delete('/clinets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const database = await connectDB();
    const collection = database.collection("clinets");
    const result = await collection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Failed to delete" });
  }
});


if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
  });
}

module.exports = app;