const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { connectDB } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || "vault_secret_key_786";

// ... আগের ইমপোর্টগুলো ঠিক থাকবে ...

router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const database = await connectDB();
    const cleanEmail = email ? email.trim().toLowerCase() : "";
    const inputPassword = password ? password.toString().trim() : "";

    let user = null;
    if (role === "admin") {
      user = await database.collection("users").findOne({ email: cleanEmail });
    } else {
      user = await database.collection("clinets").findOne({ portalEmail: cleanEmail });
    }

    if (!user) return res.status(404).json({ error: "No account found." });

    let isMatch = false;
    if (role === "admin") {
      isMatch = await bcrypt.compare(inputPassword, user.password);
    } else {
      isMatch = inputPassword === (user.password ? user.password.toString().trim() : "");
    }

    if (!isMatch) return res.status(401).json({ error: "Incorrect password." });

    // টোকেন জেনারেশন
    const token = jwt.sign({ id: user._id, role, email: cleanEmail }, JWT_SECRET, { expiresIn: "7d" });

    // ✅ রেসপন্সে 'id' পাঠানো নিশ্চিত করা হয়েছে
    res.status(200).json({
      token,
      role,
      id: user._id, // এই লাইনটি যোগ করা হয়েছে
      name: user.name || user.companyName || "User",
      email: role === "admin" ? user.email : user.portalEmail
    });

  } catch (err) {
    res.status(500).json({ error: "Server error during login." });
  }
});

router.get('/setup-my-vault', async (req, res) => {
  try {
    const database = await connectDB();
    const userCollection = database.collection("users");
    await userCollection.deleteOne({ email: "fahimmuntasim192@gmail.com" });
    const hashedPassword = await bcrypt.hash("admin786", 10);
    await userCollection.insertOne({
      name: "Fahim Muntasim",
      email: "fahimmuntasim192@gmail.com",
      password: hashedPassword,
      role: "admin",
      createdAt: new Date()
    });
    res.send(`<h1 style="color:green;">✅ Admin Account Created!</h1>`);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

module.exports = router;