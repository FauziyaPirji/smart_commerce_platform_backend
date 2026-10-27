import { Resend } from "resend";
import "dotenv/config";

export const sendEmail = async (options) => {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  // Safety check: Prevent server crash if .env key is missing
  if (!apiKey || !apiKey.startsWith("re_")) {
    console.error(
      "❌ [RESEND ERROR]: Missing or invalid RESEND_API_KEY in .env. Please add RESEND_API_KEY=re_xxxx"
    );
    return {
      success: false,
      message: "Email service not configured. Missing RESEND_API_KEY.",
    };
  }

  const toEmail = options.email || options.to;
  const subject = options.subject || "SmartCommerce Notification";
  const htmlContent = options.htmlMessage || options.html || "";

  try {
    const resend = new Resend(apiKey);

    const { data, error } = await resend.emails.send({
      // Resend's free verified sandbox sender
      from: "SmartCommerce <onboarding@resend.dev>",
      to: [toEmail],
      subject: subject,
      html: htmlContent,
    });

    if (error) {
      console.error("❌ [RESEND API ERROR]:", error);
      return { success: false, error };
    }

    console.log(`✅ [RESEND DELIVERED]: Email sent to ${toEmail} (ID: ${data?.id})`);
    return { success: true, id: data?.id };
  } catch (err) {
    console.error("❌ [RESEND EXCEPTION]:", err.message);
    return { success: false, error: err.message };
  }
};