const { MongoClient, ServerApiVersion } = require('mongodb');
const nodemailer = require('nodemailer');
require('dotenv').config();

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db;

async function connectDB() {
  if (db) return db;
  try {
    await client.connect();
    db = client.db("invoice");
    console.log("✅ MongoDB Connected");
    return db;
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    throw err;
  }
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

module.exports = { connectDB, transporter };