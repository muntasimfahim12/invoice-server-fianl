const cron = require('node-cron');
const moment = require('moment-timezone');
const { connectDB } = require('../config/db');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { generateGenieInvoicePDF } = require('../routes/invoiceRoutes');

async function sendAutomatedReminder(clinet, milestone, project) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 50 });
            let buffers = [];
            doc.on('data', (chunk) => buffers.push(chunk));
            doc.on('end', async () => {
                const pdfBuffer = Buffer.concat(buffers);
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
                });

                const emailHtml = `
                <div style="font-family: Arial, sans-serif; background-color: #f4f7f9; padding: 40px 0;">
                    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                        <div style="background-color: #4177BC; padding: 30px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Payment Reminder</h1>
                        </div>
                        <div style="padding: 40px; color: #333;">
                            <p style="font-size: 18px;">Hello <b>${clinet.name}</b>,</p>
                            <p>This is a friendly reminder for project: <b>${project.name}</b>.</p>
                            <div style="background: #f8fafc; border-left: 4px solid #4177BC; padding: 20px; margin: 20px 0;">
                                <p><strong>Phase:</strong> ${milestone.name}</p>
                                <p><strong>Amount:</strong> $${milestone.amount}</p>
                            </div>
                            <div style="text-align: center; margin-top: 30px;">
                                <a href="${process.env.FRONTEND_URL}/login" style="background: #4177BC; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px;">Access Portal</a>
                            </div>
                        </div>
                    </div>
                </div>`;

                await transporter.sendMail({
                    from: `"Genie Hack Billing" <${process.env.EMAIL_USER}>`,
                    to: clinet.email,
                    subject: `Urgent: Payment Reminder for ${milestone.name}`,
                    html: emailHtml,
                    attachments: [{ filename: `Invoice_${milestone.name}.pdf`, content: pdfBuffer }]
                });
                resolve();
            });
            generateGenieInvoicePDF(clinet, doc); 
        } catch (error) {
            reject(error);
        }
    });
}

const setupCronJobs = () => {
    cron.schedule('* * * * *', async () => {
        try {
            const database = await connectDB();
            const settings = await database.collection("settings").findOne({ id: "admin_config" });
            if (!settings || !settings.autoReminder) return;

            const now = moment().tz("Asia/Dhaka").format('YYYY-MM-DDTHH:mm');
            const clinetList = await database.collection("clinets").find({ "projects.milestones.status": "Pending" }).toArray();

            // প্রফেশনাল লুপ যা await হ্যান্ডেল করতে পারে
            for (const clinet of clinetList) {
                let hasUpdate = false;
                for (const project of clinet.projects) {
                    for (const milestone of project.milestones) {
                        const milestoneDue = moment(milestone.dueDate).format('YYYY-MM-DDTHH:mm');

                        if (milestoneDue <= now && milestone.status === "Pending" && !milestone.reminderSent) {
                            console.log(`🚀 Dispatching email to: ${clinet.email}`);
                            try {
                                await sendAutomatedReminder(clinet, milestone, project);
                                milestone.reminderSent = true;
                                hasUpdate = true;
                            } catch (err) {
                                console.error("❌ Mail Error:", err.message);
                            }
                        }
                    }
                }
                if (hasUpdate) {
                    await database.collection("clinets").updateOne(
                        { _id: clinet._id },
                        { $set: { projects: clinet.projects } }
                    );
                }
            }
        } catch (err) {
            console.error("🔥 Cron Error:", err);
        }
    });
};

module.exports = setupCronJobs;