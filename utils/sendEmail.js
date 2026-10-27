import "dotenv/config";

/**
 * Brevo Email Dispatcher using native fetch
 * Sends to ANY email address via HTTPS REST API (Port 443)
 */
export const sendEmail = async (options) => {
  const toEmail = options.email || options.to;
  const subject = options.subject || "SmartCommerce Notification";
  const htmlContent = options.htmlMessage || options.html || options.htmlContent || "";

  const apiKey = process.env.BREVO_API_KEY?.trim();

  if (!apiKey) {
    console.error("❌ [BREVO ERROR]: Missing BREVO_API_KEY in .env");
    return { success: false, message: "Missing BREVO_API_KEY" };
  }

  try {
    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        "accept": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: "SmartCommerce Support",
          email: "fauziyapirji@gmail.com", // Your verified Brevo sender email
        },
        to: [{ email: toEmail }],
        subject: subject,
        htmlContent: htmlContent,
      }),
    });

    if (!brevoRes.ok) {
      const errorText = await brevoRes.text();
      console.error("❌ Brevo email failed:", brevoRes.status, errorText);
      return { success: false, status: brevoRes.status, error: errorText };
    }

    const data = await brevoRes.json();
    console.log(`✅ [BREVO DELIVERED]: Successfully sent email to ${toEmail} (ID: ${data.messageId})`);
    return { success: true, messageId: data.messageId };
  } catch (emailError) {
    console.error("❌ Brevo email error:", emailError.message);
    return { success: false, error: emailError.message };
  }
};