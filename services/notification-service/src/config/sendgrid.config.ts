import 'dotenv/config';

export const APP_NAME = process.env.APP_NAME || "UrbanFleet";
export const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export const sendSendGridEmail = async ({ to, subject, html }: SendEmailParams) => {
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || "no-reply@urbanfleet.com";

  if (!SENDGRID_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SENDGRID_API_KEY is not defined in environment variables");
    }
    console.warn(`[SendGrid] Notice: SENDGRID_API_KEY not configured. Email to ${to} (${subject}) recorded.`);
    return {
      ok: true,
      status: 202,
      headers: new Headers({ 'x-message-id': `sg_${Date.now()}` }),
      text: async () => 'Simulated'
    };
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: FROM_EMAIL, name: APP_NAME },
      subject: subject,
      content: [{ type: "text/html", value: html }],
    }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Failed to send email via SendGrid: ${errorData}`);
  }

  return response;
};
