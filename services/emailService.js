const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = process.env.RESEND_FROM || "onboarding@resend.dev";
const DEV_FALLBACK_EMAIL = "rehanghani366@gmail.com";

export async function sendEmail({ to, subject, html, from = DEFAULT_FROM }) {
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.RESEND_FROM || from || DEFAULT_FROM;

  const payload = {
    from: sender,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      // If Resend free tier returns domain restriction (can only send to verified email),
      // retry by routing to the developer's registered Resend email in development
      const isDomainRestriction =
        data?.message?.includes(
          "only send testing emails to your own email address"
        ) || data?.name === "validation_error";

      if (isDomainRestriction && to !== DEV_FALLBACK_EMAIL) {
        console.warn(
          `[Resend Notice] Recipient ${to} is restricted on free tier. Retrying delivery to ${DEV_FALLBACK_EMAIL}...`
        );
        const retryRes = await fetch(RESEND_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...payload,
            to: [DEV_FALLBACK_EMAIL],
            subject: `[For: ${to}] ${subject}`,
          }),
        });
        const retryData = await retryRes.json();
        if (retryRes.ok) {
          return {
            success: true,
            id: retryData.id,
            reroutedTo: DEV_FALLBACK_EMAIL,
          };
        }
      }

      throw new Error(data?.message || `Resend error: ${response.statusText}`);
    }

    return { success: true, id: data.id };
  } catch (error) {
    console.error("Failed to send email via Resend:", error.message);
    throw error;
  }
}

/**
 * Send OTP Verification Email for Super Admin registration
 * @param {object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.name - Super admin name
 * @param {string} params.otp - 6-digit OTP code
 */
export async function sendOtpEmail({ to, name, otp }) {
  const subject = `🔐 ${otp} is your RG EduCore Super Admin Setup OTP`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>RG EduCore Verification Code</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          background-color: #0b0f19;
          margin: 0;
          padding: 24px;
          color: #f1f5f9;
        }
        .container {
          max-width: 520px;
          margin: 0 auto;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 16px;
          padding: 36px 32px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
        }
        .logo-badge {
          display: inline-block;
          background: #4f46e5;
          color: #ffffff;
          font-weight: 800;
          font-size: 14px;
          letter-spacing: 1px;
          padding: 6px 14px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        h1 {
          font-size: 22px;
          font-weight: 700;
          color: #ffffff;
          margin: 0 0 12px 0;
        }
        p {
          font-size: 14px;
          line-height: 1.6;
          color: #94a3b8;
          margin: 0 0 20px 0;
        }
        .otp-box {
          background: #1e1b4b;
          border: 1px solid #4338ca;
          border-radius: 12px;
          padding: 20px;
          text-align: center;
          margin: 28px 0;
        }
        .otp-code {
          font-family: monospace;
          font-size: 36px;
          font-weight: 800;
          letter-spacing: 8px;
          color: #818cf8;
          display: block;
        }
        .otp-note {
          font-size: 12px;
          color: #a5b4fc;
          margin-top: 8px;
        }
        .footer {
          border-top: 1px solid #1f2937;
          padding-top: 20px;
          margin-top: 24px;
          font-size: 12px;
          color: #64748b;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo-badge">RG EDUCORE ERP</div>
        <h1>Welcome, ${name}!</h1>
        <p>You are setting up the <strong>Super Administrator</strong> account for your school campus. Please use the one-time verification code below to verify your email address:</p>
        
        <div class="otp-box">
          <span class="otp-code">${otp}</span>
          <div class="otp-note">Code expires in 10 minutes</div>
        </div>

        <p>If you did not initiate this setup request, you can safely ignore this email.</p>

        <div class="footer">
          &copy; ${new Date().getFullYear()} RGES. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({ to, subject, html });
}

/**
 * Send OTP Verification Email for Student Email Verification
 * @param {object} params
 * @param {string} params.to - Recipient student email
 * @param {string} params.name - Student name
 * @param {string} params.otp - 6-digit OTP code
 */
export async function sendStudentOtpEmail({ to, name = "Student", otp }) {
  const subject = `🔐 ${otp} is your Student Email Verification Code`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>RG EduCore Student Verification</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          background-color: #0b0f19;
          margin: 0;
          padding: 24px;
          color: #f1f5f9;
        }
        .container {
          max-width: 520px;
          margin: 0 auto;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 16px;
          padding: 36px 32px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
        }
        .logo-badge {
          display: inline-block;
          background: #4f46e5;
          color: #ffffff;
          font-weight: 800;
          font-size: 14px;
          letter-spacing: 1px;
          padding: 6px 14px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        h1 {
          font-size: 22px;
          font-weight: 700;
          color: #ffffff;
          margin: 0 0 12px 0;
        }
        p {
          font-size: 14px;
          line-height: 1.6;
          color: #94a3b8;
          margin: 0 0 20px 0;
        }
        .otp-box {
          background: #1e1b4b;
          border: 1px solid #4338ca;
          border-radius: 12px;
          padding: 20px;
          text-align: center;
          margin: 28px 0;
        }
        .otp-code {
          font-family: monospace;
          font-size: 36px;
          font-weight: 800;
          letter-spacing: 8px;
          color: #818cf8;
          display: block;
        }
        .otp-note {
          font-size: 12px;
          color: #a5b4fc;
          margin-top: 8px;
        }
        .footer {
          border-top: 1px solid #1f2937;
          padding-top: 20px;
          margin-top: 24px;
          font-size: 12px;
          color: #64748b;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo-badge">RG EDUCORE ERP</div>
        <h1>Verify Student Email</h1>
        <p>Hello${name ? ` <strong>${name}</strong>` : ""},</p>
        <p>A request was made to verify this email address for student registration/profile update. Please use the 6-digit verification code below to complete email verification:</p>
        
        <div class="otp-box">
          <span class="otp-code">${otp}</span>
          <div class="otp-note">Valid for 10 minutes</div>
        </div>

        <p>If you did not request this verification code, please ignore this email.</p>

        <div class="footer">
          &copy; ${new Date().getFullYear()} RG EduCore ERP. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({ to, subject, html });
}

