const mongoose = require('mongoose');

const InvoiceSchema = new mongoose.Schema({
    invoiceId: String,
    projectTitle: String,
    clientName: String,
    clientEmail: String,
    clientAddress: String,
    freelancerName: String,
    freelancerAddress: String,
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
    receivedAmount: Number,
    remainingDue: Number,
    status: String,
    dueDate: String,
    currency: String,
    bankDetails: String,
    adminEmail: String,
    createdAt: Date
});

module.exports = mongoose.model('Invoice', InvoiceSchema);