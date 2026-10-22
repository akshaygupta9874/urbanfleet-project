import 'dotenv/config';
import axios, { isAxiosError } from 'axios';

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
    throw new Error("SENDGRID_API_KEY is not defined in environment variables");
  }

  try {
    const response = await axios.post(
      "https://api.sendgrid.com/v3/mail/send",
      {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: FROM_EMAIL, name: APP_NAME },
        subject: subject,
        content: [{ type: "text/html", value: html }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SENDGRID_API_KEY}`,
        },
        timeout: 5000,
      }
    );

    return response;
  } catch (error: unknown) {
    if (isAxiosError(error)) {
      const errorData = typeof error.response?.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response?.data || error.message);
      throw new Error(`Failed to send email via SendGrid: ${errorData}`);
    }
    throw error;
  }
};
