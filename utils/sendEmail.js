import axios from "axios";
import "dotenv/config";

/**
 * Cloud-Ready Email Sender via Brevo HTTP REST API
 * - Sends to ANY email address (no custom domain required)
 * - Uses HTTPS (Port 443) -> Never blocked by Render, Vercel, or Railway
 */
export const sendEmail = async (options) => {
  const apiKey = process.env.BREVO_API_KEY?.trim();

  if (!apiKey || !apiKey.startsWith("xkeysib-")) {
    console.error("❌ [EMAIL ERROR]: Missing or invalid BREVO_API_KEY in .env");
    return { success: false, message: "Missing BREVO_API_KEY" };
  }

  const toEmail = options.email || options.to;
  const subject = options.subject || "SmartCommerce Notification";
  const htmlContent = options.htmlMessage || options.html || "";

  try {
    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: "SmartCommerce Support",
          email: "pirjifauziya@gmail.com", // Your verified Gmail
        },
        to: [{ email: toEmail }],
        subject: subject,
        htmlContent: htmlContent,
      },
      {
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    console.log(`✅ [EMAIL DELIVERED]: Successfully sent to ${toEmail} (MessageId: ${response.data?.messageId})`);
    return { success: true, messageId: response.data?.messageId };
  } catch (error) {
    console.error(
      "❌ [BREVO API ERROR]:",
      error.response?.data?.message || error.message
    );
    return { success: false, error: error.response?.data || error.message };
  }
};