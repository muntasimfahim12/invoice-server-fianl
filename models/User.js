const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  role: { type: String, default: 'Super Admin' },
  about: { type: String, default: 'Redefining security with Vault. ✨' },
  profilePic: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);