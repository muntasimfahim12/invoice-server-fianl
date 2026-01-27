const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  paypalLink: { type: String, default: "" },
  currency: { type: String, default: "USD" },
  businessName: { type: String, default: "" },
  adminEmail: { type: String, default: "" },
}, { timestamps: true });

module.exports = mongoose.model('Settings', SettingsSchema);