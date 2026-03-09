const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASS  
  }
});

/**
 * @param {string} to - ক্লায়েন্টের ইমেইল
 * @param {object} milestone - মাইলস্টোন অবজেক্ট (name, amount, dueDate)
 * @param {string} clinetName - ক্লায়েন্টের নাম (ঐচ্ছিক কিন্তু প্রফেশনাল)
 */
const sendReminderMail = async (to, milestone, clinetName = "Valued Client") => {
  const mailOptions = {
    from: `"Genie Hack Billing" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: `Urgent: Payment Reminder for ${milestone.name}`,
    // আধুনিক এবং রেসপন্সিভ HTML ডিজাইন
    html: `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f9fafb; padding: 20px; color: #1f2937;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden;">
            <div style="background-color: #4177BC; padding: 20px; text-align: center; color: white;">
                <h2 style="margin: 0; font-size: 22px;">Payment Reminder</h2>
            </div>
            <div style="padding: 30px;">
                <p style="font-size: 16px;">Hello <b>${clinetName}</b>,</p>
                <p style="font-size: 15px; color: #4b5563;">This is a friendly notification that a payment is now due for your project milestone.</p>
                
                <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 20px 0;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 5px 0; color: #6b7280;">Milestone:</td>
                            <td style="padding: 5px 0; font-weight: bold; text-align: right;">${milestone.name}</td>
                        </tr>
                        <tr>
                            <td style="padding: 5px 0; color: #6b7280;">Amount:</td>
                            <td style="padding: 5px 0; font-weight: bold; text-align: right; color: #4177BC; font-size: 18px;">$${milestone.amount}</td>
                        </tr>
                        <tr>
                            <td style="padding: 5px 0; color: #6b7280;">Due Date:</td>
                            <td style="padding: 5px 0; font-weight: bold; text-align: right;">${milestone.dueDate}</td>
                        </tr>
                    </table>
                </div>

                <div style="text-align: center; margin-top: 30px;">
                    <a href="${process.env.FRONTEND_URL}/login" 
                       style="display: inline-block; padding: 12px 25px; background-color: #4177BC; color: white; text-decoration: none; border-radius: 5px; font-weight: 600;">
                       Make Payment
                    </a>
                </div>
            </div>
            <div style="padding: 20px; text-align: center; background-color: #f9fafb; color: #9ca3af; font-size: 12px;">
                <p>© ${new Date().getFullYear()} Genie Hack Ltd. All rights reserved.</p>
            </div>
        </div>
    </div>`
  };

  return transporter.sendMail(mailOptions);
};

module.exports = { sendReminderMail };