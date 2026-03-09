const mongoose = require('mongoose');

const InvoiceSchema = new mongoose.Schema({
    invoiceId: String,
    projectId: mongoose.Schema.Types.ObjectId, // প্রজেক্টের সাথে লিঙ্ক করার জন্য
    projectTitle: String,
    clientName: String,
    clientEmail: String,
    clientAddress: String,
    freelancerName: String,
    freelancerAddress: String,
    
    // মাইলস্টোন ভিত্তিক পেমেন্ট ট্র্যাকিং
    milestones: [{
        id: String,
        name: { type: String, required: true },
        amount: { type: Number, required: true },
        dueDate: { type: Date, required: true }, 
        status: { type: String, enum: ['Paid', 'Unpaid'], default: 'Unpaid' }, //
        paymentDate: Date,
        reminderSent: { type: Boolean, default: false }
    }],

    items: [{
        id: Number,
        name: String,
        qty: Number,
        price: Number
    }],

    subtotal: Number,
    taxRate: Number,
    taxAmount: Number,
    discount: Number,
    grandTotal: Number,
    totalPaid: { type: Number, default: 0 }, 
    remainingDue: Number,
    status: { type: String, default: 'Pending' }, 
    currency: { type: String, default: 'USD' },
    bankDetails: String,
    adminEmail: String,
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Invoice', InvoiceSchema);