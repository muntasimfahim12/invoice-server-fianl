const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { connectDB } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || "vault_secret_key_786";

/* --- NODEMAILER CONFIG --- */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/* --- HELPERS --- */
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const getAuthContext = (role, email) => {
  const cleanEmail = email ? email.trim().toLowerCase() : "";
  const collectionName = role === "admin" ? "users" : "clinets";

  // ক্লায়েন্টের ক্ষেত্রে portalEmail অথবা email—যে কোনো একটি মিললেই হবে
  const filter = role === "admin"
    ? { email: cleanEmail }
    : { $or: [{ portalEmail: cleanEmail }, { email: cleanEmail }] };

  return { collectionName, filter, cleanEmail };
};

/* --- LOGIN ROUTE (FIXED & DEBUGGED) --- */
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    console.log(`Login attempt: ${email} as ${role}`); // Debug 1

    if (!email || !password || !role) {
      return res.status(400).json({ error: "Please provide all credentials." });
    }

    const database = await connectDB();
    const { collectionName, filter } = getAuthContext(role, email);

    console.log(`Searching in ${collectionName} with filter:`, JSON.stringify(filter)); // Debug 2

    const user = await database.collection(collectionName).findOne(filter);

    if (!user) {
      console.log("No user found in database."); // Debug 3
      return res.status(404).json({ error: "No account found." });
    }

    console.log("User found, checking password..."); // Debug 4

    // পাসওয়ার্ড চেক
    const inputPassword = password.toString().trim();
    let isMatch = false;

    if (user.password && (user.password.startsWith('$2a$') || user.password.startsWith('$2b$'))) {
      isMatch = await bcrypt.compare(inputPassword, user.password);
    } else {
      isMatch = inputPassword === (user.password ? user.password.toString().trim() : "");
    }

    if (!isMatch) {
      console.log("Password did not match."); // Debug 5
      return res.status(401).json({ error: "Invalid password." });
    }

    const token = jwt.sign(
      { id: user._id, role, email: email.toLowerCase() },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log("Login successful, sending response..."); // Debug 6

    res.status(200).json({
      token,
      role,
      id: user._id,
      name: user.name || user.companyName || "User",
      email: user.email || user.portalEmail || email
    });

  } catch (err) {
    console.error("CRITICAL LOGIN ERROR:", err); // এটি আপনার টার্মিনালে আসল এরর দেখাবে
    res.status(500).json({ error: "Server error during login." });
  }
});

/* --- 1. FORGET PASSWORD (SEND OTP) --- */
router.post('/forget-password', async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email || !role) return res.status(400).json({ error: "Email and Role are required." });

    const database = await connectDB();
    const { collectionName, filter, cleanEmail } = getAuthContext(role, email);

    const user = await database.collection(collectionName).findOne(filter);
    if (!user) return res.status(404).json({ error: "Account not found." });

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60000); // 10 minutes expiry

    await database.collection(collectionName).updateOne(filter, {
      $set: { resetOTP: otp, otpExpires: otpExpires }
    });

    const mailOptions = {
      from: `"Vault Security" <${process.env.EMAIL_USER}>`,
      to: cleanEmail,
      subject: `${otp} is your recovery code`,
      html: `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
          <div style="background-color: #2563eb; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 2px;">Vault</h1>
          </div>
          <div style="padding: 32px; text-align: center;">
            <h2 style="color: #111827; margin-bottom: 16px;">Password Reset Request</h2>
            <p style="color: #4b5563; font-size: 16px; line-height: 24px;">Someone requested to reset your password. Use the following code to proceed:</p>
            <div style="margin: 32px 0; background-color: #f3f4f6; border-radius: 8px; padding: 20px;">
              <span style="font-size: 36px; font-weight: bold; letter-spacing: 6px; color: #2563eb;">${otp}</span>
            </div>
            <p style="color: #9ca3af; font-size: 14px;">This code will expire in 10 minutes. If you did not make this request, please ignore this email.</p>
          </div>
          <div style="background-color: #f9fafb; padding: 16px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">&copy; 2026 Vault Security Portal.</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: "OTP sent successfully." });

  } catch (err) {
    res.status(500).json({ error: "Failed to send OTP." });
  }
});

/* --- 2. VERIFY OTP CODE --- */
router.post('/verify-code', async (req, res) => {
  try {
    const { email, code, role } = req.body;
    if (!email || !code || !role) return res.status(400).json({ error: "Information missing." });

    const database = await connectDB();
    const { collectionName, filter } = getAuthContext(role, email);

    const user = await database.collection(collectionName).findOne(filter);

    if (!user || user.resetOTP !== code) {
      return res.status(400).json({ error: "Invalid verification code." });
    }

    if (new Date() > new Date(user.otpExpires)) {
      return res.status(400).json({ error: "OTP has expired." });
    }

    res.status(200).json({ message: "Code verified. You may now reset your password." });
  } catch (err) {
    res.status(500).json({ error: "Verification failed." });
  }
});

/* --- 3. RESET PASSWORD --- */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword, role } = req.body;
    if (!email || !code || !newPassword || !role) return res.status(400).json({ error: "All fields are required." });

    const database = await connectDB();
    const { collectionName, filter } = getAuthContext(role, email);

    const user = await database.collection(collectionName).findOne(filter);

    if (!user || user.resetOTP !== code) {
      return res.status(400).json({ error: "Unauthorized attempt." });
    }

    const hashedPassword = await bcrypt.hash(newPassword.toString(), 10);

    await database.collection(collectionName).updateOne(filter, {
      $set: { password: hashedPassword },
      $unset: { resetOTP: "", otpExpires: "" }
    });

    res.status(200).json({ message: "Success! Password updated." });
  } catch (err) {
    res.status(500).json({ error: "Failed to reset password." });
  }
});

module.exports = router;