const express = require('express');
const cors = require('cors');
require('dotenv').config();

// ১. আপনার নতুন তৈরি করা cronJobs হেল্পারটি ইম্পোর্ট করুন
const setupCronJobs = require('./utils/cronJobs'); 

// Routes Import
const authRoutes = require('./routes/authRoutes');
const clientRoutes = require('./routes/clientRoutes');
const { router: invoiceRoutes } = require('./routes/invoiceRoutes'); 
const generalRoutes = require('./routes/generalRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true
}));

app.use(express.json());

setupCronJobs(); 

// Routes Implementation 
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/clinets', clientRoutes); 
app.use('/invoices', invoiceRoutes); 
app.use('/', generalRoutes);

app.get('/', (req, res) => {
  res.send('🚀 Server Running with Automated Reminders');
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
  });
}

module.exports = app;