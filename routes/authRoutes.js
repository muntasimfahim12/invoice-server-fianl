const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { connectDB } = require('../config/db');
const User = require('../models/User');
const { ObjectId } = require('mongodb');

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

  const filter = role === "admin"
    ? { email: cleanEmail }
    : { $or: [{ portalEmail: cleanEmail }, { email: cleanEmail }] };

  return { collectionName, filter, cleanEmail };
};

/* --- 1. ADMIN ACCESS REQUEST (Registration) --- */
router.post('/register-request', async (req, res) => {
  try {
    const { name, email, password, companyName } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: "Name, Email and Password are required." });
    }

    const database = await connectDB();
    const cleanEmail = email.trim().toLowerCase();

    const existingUser = await database.collection('users').findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({ error: "Account already exists or request is pending." });
    }

    const hashedPassword = await bcrypt.hash(password.toString(), 10);

    const newRequest = {
      name,
      email: cleanEmail,
      password: hashedPassword,
      companyName: companyName || "Independent Agency",
      role: 'admin',
      status: 'pending',
      createdAt: new Date(),
      isSuperAdmin: false
    };

    await database.collection('users').insertOne(newRequest);
    res.status(201).json({ message: "Access request submitted. Please wait for admin approval." });
  } catch (err) {
    console.error("REGISTER REQUEST ERROR:", err);
    res.status(500).json({ error: "Failed to submit registration request." });
  }
});

/* --- 2. LOGIN ROUTE (With Status Check) --- */
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: "Please provide all credentials." });
    }

    const database = await connectDB();
    const { collectionName, filter } = getAuthContext(role, email);
    const user = await database.collection(collectionName).findOne(filter);

    if (!user) return res.status(404).json({ error: "No account found." });

    // Status Validation
    if (role === "admin") {
      if (user.status === "pending") {
        return res.status(403).json({ error: "Your account is pending approval." });
      }
      if (user.status === "rejected") {
        return res.status(403).json({ error: "Access denied. Your request was rejected." });
      }
    }

    // Password Validation
    const isMatch = await bcrypt.compare(password.toString().trim(), user.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid password." });

    const token = jwt.sign(
      { id: user._id, role, email: user.email, isSuperAdmin: user.isSuperAdmin || false },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      token,
      role,
      id: user._id,
      name: user.name || user.companyName,
      email: user.email || user.portalEmail,
      status: user.status,
      isSuperAdmin: user.isSuperAdmin || false
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: "Server error during login." });
  }
});

/* --- 3. GET ALL USERS (For Super Admin Dashboard) --- */
router.get('/all-users', async (req, res) => {
  try {
    const database = await connectDB();
    // সব ইউজার নিয়ে আসা হচ্ছে (ড্যাশবোর্ড ফিল্টার করবে)
    const users = await database.collection('users').find({}).toArray();

    // সিকিউরিটি: পাসওয়ার্ড এবং ওটিপি বাদ দিয়ে পাঠানো
    const safeUsers = users.map(({ password, resetOTP, otpExpires, ...rest }) => rest);
    res.status(200).json(safeUsers);
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch users." });
  }
});

/* --- 4. MANAGE REQUEST (Approve/Reject) --- */
router.patch('/manage-request', async (req, res) => {
  try {
    const { requestId, action } = req.body; // action: 'active' or 'rejected'
    const database = await connectDB();

    const updateStatus = action === 'active' ? 'active' : 'rejected';

    const user = await database.collection('users').findOne({ _id: new ObjectId(requestId) });
    if (!user) return res.status(404).json({ error: "Request not found." });

    await database.collection('users').updateOne(
      { _id: new ObjectId(requestId) },
      { $set: { status: updateStatus } }
    );

    // Email Notification
    if (updateStatus === 'active') {
      const mailOptions = {
        from: `"Vault Security" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: "Access Approved - Vault Portal",
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #4177BC;">Account Approved!</h2>
            <p>Hello ${user.name}, your access request for <b>${user.companyName}</b> has been approved.</p>
            <p>You can now login to your dashboard.</p>
            <div style="margin-top: 20px;">
              <a href="${process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000'}/login" 
                 style="background: #4177BC; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                 Login Now
              </a>
            </div>
          </div>`
      };
      await transporter.sendMail(mailOptions);
    }

    res.status(200).json({ message: `Admin has been ${updateStatus}.` });
  } catch (err) {
    console.error("MANAGE REQUEST ERROR:", err);
    res.status(500).json({ error: "Action failed." });
  }
});

/* --- 5. FORGET PASSWORD (OTP) --- */
router.post('/forget-password', async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email || !role) return res.status(400).json({ error: "Email and Role are required." });

    const database = await connectDB();
    const { collectionName, filter, cleanEmail } = getAuthContext(role, email);

    const user = await database.collection(collectionName).findOne(filter);
    if (!user) return res.status(404).json({ error: "Account not found." });

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60000);

    await database.collection(collectionName).updateOne(filter, {
      $set: { resetOTP: otp, otpExpires: otpExpires }
    });

    const mailOptions = {
      from: `"Vault Security" <${process.env.EMAIL_USER}>`,
      to: cleanEmail,
      subject: `${otp} is your recovery code`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #4177BC; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0;">Vault</h1>
          </div>
          <div style="padding: 32px; text-align: center;">
            <h2>Password Reset Code</h2>
            <div style="margin: 32px 0; background-color: #f3f4f6; padding: 20px; font-size: 36px; font-weight: bold; letter-spacing: 6px; color: #4177BC;">
              ${otp}
            </div>
            <p>Expires in 10 minutes.</p>
          </div>
        </div>`
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: "OTP sent successfully." });
  } catch (err) {
    res.status(500).json({ error: "Failed to send OTP." });
  }
});

/* --- 6. VERIFY OTP --- */
router.post('/verify-code', async (req, res) => {
  try {
    const { email, code, role } = req.body;
    const database = await connectDB();
    const { collectionName, filter } = getAuthContext(role, email);
    const user = await database.collection(collectionName).findOne(filter);

    if (!user || user.resetOTP !== code) {
      return res.status(400).json({ error: "Invalid verification code." });
    }
    if (new Date() > new Date(user.otpExpires)) {
      return res.status(400).json({ error: "OTP has expired." });
    }
    res.status(200).json({ message: "Code verified." });
  } catch (err) {
    res.status(500).json({ error: "Verification failed." });
  }
});





/* --- 4.1 DELETE USER (Native MongoDB Driver Version) --- */
router.delete("/delete-user/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const database = await connectDB();

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid ID format" });
    }

    const result = await database.collection('users').deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      const clientResult = await database.collection('clinets').deleteOne({ _id: new ObjectId(id) });

      if (clientResult.deletedCount === 0) {
        return res.status(404).json({ error: "User not found in system." });
      }
    }

    res.status(200).json({ message: "Entity successfully purged from database" });
  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).json({ error: "Database communication failure" });
  }
});
/* --- 7. RESET PASSWORD --- */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword, role } = req.body;
    const database = await connectDB();
    const { collectionName, filter } = getAuthContext(role, email);

    const hashedPassword = await bcrypt.hash(newPassword.toString(), 10);
    await database.collection(collectionName).updateOne(filter, {
      $set: { password: hashedPassword },
      $unset: { resetOTP: "", otpExpires: "" }
    });

    res.status(200).json({ message: "Password updated successfully." });
  } catch (err) {
    res.status(500).json({ error: "Failed to reset password." });
  }
});

module.exports = router;