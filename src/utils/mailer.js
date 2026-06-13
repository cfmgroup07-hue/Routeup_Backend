const nodemailer = require('nodemailer');

const sendEmail = async ({ to, subject, htmlContent, attachments = [] }) => {
  try {
    let transporter;

    if (process.env.EMAIL_HOST && process.env.EMAIL_USER) {
      // Use Real SMTP credentials from .env
      transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT || 465,
        secure: Number(process.env.EMAIL_PORT) === 465, // true for 465, false for other ports
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
    } else {
      // Fallback to Ethereal Email for local testing if env is missing
      console.warn("Using Ethereal testing email because real credentials are missing from .env");
      let testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false, 
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    }

    let info = await transporter.sendMail({
      from: `"RouteUp" <${process.env.EMAIL_USER || 'admin@routeup.com'}>`,
      to: to,
      subject: subject,
      html: htmlContent,
      attachments: attachments
    });

    console.log("Email sent successfully to:", to);
    if (!process.env.EMAIL_HOST) {
      console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
    }
    return info;
  } catch (error) {
    console.error("Error sending email: ", error);
    throw error;
  }
};

module.exports = {
  sendEmail
};
