import nodemailer from "nodemailer";

export const sendEmail = async (options) => {
  // Create reusable transporter using Gmail SMTP or any email service
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "pirjifauziya@gmail.com",
      pass: "lxcw epvu zorz qkez",
    },
  });

  // Mail details
  const mailOptions = {
    from: '"SmartCommerce Support" <no-reply@smartcommerce.com>',
    to: options.email,
    subject: options.subject,
    html: options.htmlMessage,
  };

  // Send the email
  await transporter.sendMail(mailOptions);
};
