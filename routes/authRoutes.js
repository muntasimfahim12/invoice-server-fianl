const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { connectDB } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || "vault_secret_key_786";

/* ================= NODEMAILER CONFIG ================= */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/* ================= HELPERS ================= */
// 6 Digit Code Generator
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

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
      // Client-er jonno direct comparison (jodi hash na kora thake)
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

/* ================= 1. FORGET PASSWORD (SEND OTP) ================= */
router.post('/forget-password', async (req, res) => {
  try {
    const { email, role } = req.body;
    const database = await connectDB();
    const cleanEmail = email.trim().toLowerCase();
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60000); // 10 minutes expiry

    const collectionName = role === "admin" ? "users" : "clinets";
    const filter = role === "admin" ? { email: cleanEmail } : { portalEmail: cleanEmail };

    const user = await database.collection(collectionName).findOne(filter);
    if (!user) return res.status(404).json({ error: "Account not found." });

    // Save OTP to User Document temporary
    await database.collection(collectionName).updateOne(filter, {
      $set: { resetOTP: otp, otpExpires: otpExpires }
    });

    const mailOptions = {
      from: `"Vault Security" <${process.env.EMAIL_USER}>`,
      to: cleanEmail,
      subject: `${otp} is your Vault recovery code`,
      html: `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f9fafb; padding: 40px 0;">
      <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="background-color: #2563eb; padding: 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 2px;">VAULT</h1>
        </div>
        <div style="padding: 40px 30px; text-align: center;">
          <h2 style="color: #111827; margin-bottom: 20px; font-size: 22px;">Recover Your Account</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 24px;">Someone requested a password reset for your Vault account. Use the code below to proceed:</p>
          
          <div style="margin: 35px 0; background-color: #f3f4f6; border-radius: 12px; padding: 20px;">
            <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #2563eb;">${otp}</span>
          </div>
          
          <p style="color: #9ca3af; font-size: 14px;">This code will expire in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
        </div>
        <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">&copy; 2026 Vault Portal. All rights reserved.</p>
        </div>
      </div>
    </div>
  `
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: "OTP sent to your email." });

  } catch (err) {
    res.status(500).json({ error: "Failed to send OTP." });
  }
});

/* ================= 2. VERIFY OTP CODE ================= */
router.post('/verify-code', async (req, res) => {
  try {
    const { email, code, role } = req.body;
    const database = await connectDB();
    const collectionName = role === "admin" ? "users" : "clinets";
    const filter = role === "admin" ? { email: email.toLowerCase() } : { portalEmail: email.toLowerCase() };

    const user = await database.collection(collectionName).findOne(filter);

    if (!user || user.resetOTP !== code || new Date() > user.otpExpires) {
      return res.status(400).json({ error: "Invalid or expired code." });
    }

    res.status(200).json({ message: "Code verified. You can reset password now." });
  } catch (err) {
    res.status(500).json({ error: "Verification failed." });
  }
});

/* ================= 3. RESET PASSWORD ================= */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword, role } = req.body;
    const database = await connectDB();
    const collectionName = role === "admin" ? "users" : "clinets";
    const filter = role === "admin" ? { email: email.toLowerCase() } : { portalEmail: email.toLowerCase() };

    const user = await database.collection(collectionName).findOne(filter);

    if (!user || user.resetOTP !== code) {
      return res.status(400).json({ error: "Unauthorized reset request." });
    }

    let finalPassword = newPassword;
    if (role === "admin") {
      finalPassword = await bcrypt.hash(newPassword, 10);
    }

    await database.collection(collectionName).updateOne(filter, {
      $set: { password: finalPassword },
      $unset: { resetOTP: "", otpExpires: "" } // Clear OTP after success
    });

    res.status(200).json({ message: "Password reset successful!" });
  } catch (err) {
    res.status(500).json({ error: "Failed to reset password." });
  }
});

module.exports = router;