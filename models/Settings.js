const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  // ১. Profile & Branding
  businessName: { type: String, default: "My Agency" },
  businessLogo: { type: String, default: "" }, // লোগোর URL রাখার জন্য
  adminEmail: { type: String, required: true },
  contactPhone: { type: String, default: "" },
  address: { type: String, default: "" },
  currency: { type: String, default: "USD" }, // যেমন: USD, BDT
  currencySymbol: { type: String, default: "$" }, // যেমন: $, ৳ (এটি ইনভয়েসে দরকার হয়)

  // ২. Invoice & Tax Configuration
  invPrefix: { type: String, default: "INV-" },
  taxRate: { type: Number, default: 0 },
  dueDays: { type: Number, default: 7 },
  termsConditions: { type: String, default: "Payment is due within 7 days." },

  // ৩. Payment Methods
  paypalLink: { type: String, default: "" }, 
  stripePublicKey: { type: String, default: "" },
  bankDetails: { type: String, default: "" }, 

  // ৪. Automation & Notification Toggles
  autoReminder: { type: Boolean, default: true },
  installmentAutoTrigger: { type: Boolean, default: true },
  emailNotif: { type: Boolean, default: true },

  // ৫. System Configuration (Internal)
  maintenanceMode: { type: Boolean, default: false },
  lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }

}, {
  timestamps: true,
  // capped: { size: 1024, max: 1 } // এটি নিশ্চিত করে ডাটাবেসে একটাই সেটিংস ডকুমেন্ট থাকবে
});

module.exports = mongoose.model('Settings', SettingsSchema);