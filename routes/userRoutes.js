const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const User = require('../models/User'); // পাথ ঠিক রাখা হয়েছে

// Cloudinary Config (আপনার .env ফাইল থেকে কীগুলো নিবে)
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'vault_profiles',
    allowed_formats: ['jpg', 'png', 'jpeg'],
  },
});
const upload = multer({ storage: storage });

// ইউজারের ডেটা দেখা (GET)
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

// নাম ও বায়ো আপডেট (PUT)
router.put('/:id', async (req, res) => {
  try {
    const { name, about } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { name, about },
      { new: true }
    );
    res.json(updatedUser);
  } catch (err) {
    res.status(500).json({ message: "Update failed" });
  }
});

// প্রোফাইল পিকচার আপলোড (POST)
router.post('/upload/:id', upload.single('profilePic'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file!" });
    const imageUrl = req.file.path;
    await User.findByIdAndUpdate(req.params.id, { profilePic: imageUrl });
    res.json({ url: imageUrl, message: "Success" });
  } catch (err) {
    res.status(500).json({ message: "Upload failed" });
  }
});

module.exports = router;