const { MongoClient, ServerApiVersion } = require('mongodb');
const mongoose = require('mongoose'); // Mongoose ইমপোর্ট করুন
const nodemailer = require('nodemailer');
require('dotenv').config();

const uri = process.env.MONGO_URI;

// MongoClient setup
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db;

async function connectDB() {
  if (db && mongoose.connection.readyState === 1) return db;

  try {
    // ১. MongoClient কানেক্ট করা (আপনার বর্তমান কোড)
    await client.connect();
    db = client.db("invoice");
    console.log("✅ MongoDB Native Client Connected");

    // ২. Mongoose কানেক্ট করা (এটি না থাকলে settings.findOne কাজ করবে না)
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(uri, {
        dbName: "invoice", // আপনার ডাটাবেজের নাম নিশ্চিত করুন
      });
      console.log("✅ Mongoose Connected");
    }

    return db;
  } catch (err) {
    console.error("❌ Database Connection Error:", err);
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