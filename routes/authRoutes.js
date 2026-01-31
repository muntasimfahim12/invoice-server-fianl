const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer'); // ✅ Nodemailer ইমপোর্ট করা হয়েছে
const { connectDB } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || "vault_secret_key_786";

/* ================= NODEMAILER CONFIG ================= */
// ✅ ট্রান্সপোর্টারটি রাউটের বাইরে ডিফাইন করা হয়েছে যাতে ReferenceError না আসে
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASS  
  }
});

/* ================= LOGIN ROUTE ================= */
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

    const token = jwt.sign({ id: user._id, role, email: cleanEmail }, JWT_SECRET, { expiresIn: "7d" });

    res.status(200).json({
      token,
      role,
      id: user._id,
      name: user.name || user.companyName || "User",
      email: role === "admin" ? user.email : user.portalEmail
    });

  } catch (err) {
    res.status(500).json({ error: "Server error during login." });
  }
});

/* ================= FORGET PASSWORD ROUTE ================= */
router.post('/forget-password', async (req, res) => {
  try {
    const { email, role } = req.body;
    const database = await connectDB();
    const cleanEmail = email ? email.trim().toLowerCase() : "";

    let user = null;
    if (role === "admin") {
      user = await database.collection("users").findOne({ email: cleanEmail });
    } else {
      user = await database.collection("clinets").findOne({ portalEmail: cleanEmail });
    }

    if (!user) {
      return res.status(404).json({ error: "No account found with this email." });
    }

    const userName = user.name || user.companyName || "User";
    let passwordToSend = "";

    if (role === "admin") {
      // এডমিনদের জন্য সিকিউরিটি নোট: সরাসরি হ্যাশ পাঠানো যাবে না
      passwordToSend = "Your password is encrypted. Please contact management to reset it.";
    } else {
      passwordToSend = `Your Password: ${user.password}`;
    }

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: cleanEmail,
      subject: 'Password Recovery - Vault Portal',
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #4177BC;">Hello, ${userName}</h2>
          <p>You requested password recovery for your <strong>${role}</strong> account.</p>
          <div style="background: #f4f4f4; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 5px solid #4177BC;">
            <p style="margin: 0; font-size: 16px;">${passwordToSend}</p>
          </div>
          <p style="font-size: 12px; color: #888;">If you didn't request this, please ignore this email.</p>
          <br/>
          <p>Regards,<br/><strong>Vault Admin Team</strong></p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: "Password recovery details sent to your email!" });

  } catch (err) {
    console.error("Forget Pass Error:", err);
    res.status(500).json({ error: "Server error during recovery." });
  }
});

/* ================= SETUP ROUTE ================= */
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