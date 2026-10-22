import { APP_NAME, FRONTEND_URL, sendSendGridEmail } from "../config/sendgrid.config.js";

interface OtpEmailParams {
  email: string;
  otp: string;
  expiresInMinutes?: number;
}

interface VerifyEmailParams {
  email: string;
  token: string;
}

interface ResetPasswordEmailParams {
  email: string;
  token: string;
}

const ACCENT = "#111827"; 
const YEAR = new Date().getFullYear();

const baseStyles = `
html, body { margin: 0; padding: 0; }
body {
  background: #f6f7fb;
  color: #111;
  -webkit-text-size-adjust: 100%;
  -ms-text-size-adjust: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}
table { border-collapse: collapse; }
img { border: 0; line-height: 100%; outline: none; text-decoration: none; display: block; max-width: 100%; height: auto; }
.wrapper { width: 100%; background: #f6f7fb; }
.container {
  width: 600px;
  max-width: 600px;
  background: #ffffff;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e9ecf3;
}
.p-24 { padding: 24px; }
.p-32 { padding: 32px; }
.header {
  background: ${ACCENT};
  padding: 20px 24px;
  text-align: center;
}
.brand {
  display: inline-block;
  color: #ffffff;
  font-weight: 700;
  font-size: 17px;
  letter-spacing: 0.3px;
  text-decoration: none;
}
.title { margin: 0 0 12px 0; font-size: 22px; line-height: 1.3; color: #111; font-weight: 700; }
.text { margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #444; }
.muted { color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 12px 0; }
.otp-wrap { margin: 24px 0; width: 100%; }
.otp {
  display: inline-block;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 16px 22px;
  font-size: 32px;
  letter-spacing: 10px;
  font-weight: 700;
  color: #111;
}
.btn {
  display: inline-block;
  background: ${ACCENT};
  color: #ffffff !important;
  text-decoration: none;
  padding: 12px 20px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
}
.link { color: ${ACCENT}; text-decoration: underline; word-break: break-all; }
.footer { text-align: center; color: #6b7280; font-size: 12px; line-height: 1.6; padding: 16px 24px 0 24px; }
`;

export const getOtpHtml = ({ email, otp, expiresInMinutes = 5 }: OtpEmailParams): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${APP_NAME} Verification Code</title>
<style>${baseStyles}</style>
</head>
<body>
<table role="presentation" class="wrapper" width="100%">
<tr>
<td align="center" class="p-24">
<table role="presentation" class="container">
<tr><td class="header"><span class="brand">${APP_NAME}</span></td></tr>
<tr><td class="p-32">
<h1 class="title">Verify your email</h1>
<p class="text">Use the verification code below to sign in as <strong>${email}</strong>.</p>
<table role="presentation" class="otp-wrap"><tr><td align="center"><div class="otp">${otp}</div></td></tr></table>
<p class="muted">Expires in <strong>${expiresInMinutes} minutes</strong>.</p>
</td></tr>
<tr><td class="footer">© ${YEAR} ${APP_NAME}. All rights reserved.</td></tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
};

export const getVerifyEmailHtml = ({ email, token }: VerifyEmailParams): string => {
  const verifyUrl = `${FRONTEND_URL.replace(/\/+$/, "")}/token/${encodeURIComponent(token)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${APP_NAME} Verify Your Account</title>
<style>${baseStyles}</style>
</head>
<body>
<table role="presentation" class="wrapper" width="100%">
<tr>
<td align="center" class="p-24">
<table role="presentation" class="container">
<tr><td class="header"><span class="brand">${APP_NAME}</span></td></tr>
<tr><td class="p-32">
<h1 class="title">Verify your account</h1>
<p class="text">Thanks for registering with ${APP_NAME} as <strong>${email}</strong>.</p>
<table role="presentation" style="margin: 16px 0 20px 0;"><tr><td align="center"><a class="btn" href="${verifyUrl}" target="_blank">Verify account</a></td></tr></table>
<p class="muted">Or visit: <a class="link" href="${verifyUrl}">${verifyUrl}</a></p>
</td></tr>
<tr><td class="footer">© ${YEAR} ${APP_NAME}. All rights reserved.</td></tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
};

export const getResetPasswordHtml = ({ email, token }: ResetPasswordEmailParams): string => {
  const resetUrl = `${FRONTEND_URL.replace(/\/+$/, "")}/reset-password/${encodeURIComponent(token)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${APP_NAME} Reset Your Password</title>
<style>${baseStyles}</style>
</head>
<body>
<table role="presentation" class="wrapper" width="100%">
<tr>
<td align="center" class="p-24">
<table role="presentation" class="container">
<tr><td class="header"><span class="brand">${APP_NAME}</span></td></tr>
<tr><td class="p-32">
<h1 class="title">Reset your password</h1>
<p class="text">We received a password reset request for <strong>${email}</strong>.</p>
<table role="presentation" style="margin: 16px 0 20px 0;"><tr><td align="center"><a class="btn" href="${resetUrl}" target="_blank">Reset password</a></td></tr></table>
<p class="muted">Or visit: <a class="link" href="${resetUrl}">${resetUrl}</a></p>
</td></tr>
<tr><td class="footer">© ${YEAR} ${APP_NAME}. All rights reserved.</td></tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
};

export const sendOtpEmail = async (params: OtpEmailParams) => {
  return sendSendGridEmail({
    to: params.email,
    subject: `${params.otp} is your ${APP_NAME} verification code`,
    html: getOtpHtml(params),
  });
};

export const sendVerifyEmail = async (params: VerifyEmailParams) => {
  return sendSendGridEmail({
    to: params.email,
    subject: `Verify your ${APP_NAME} account`,
    html: getVerifyEmailHtml(params),
  });
};

export const sendResetPasswordEmail = async (params: ResetPasswordEmailParams) => {
  return sendSendGridEmail({
    to: params.email,
    subject: `Reset your ${APP_NAME} password`,
    html: getResetPasswordHtml(params),
  });
};

export interface RideReceiptEmailParams {
  email: string;
  rideId: string;
  paymentId?: string;
  totalFarePaise?: number;
  pickupAddress?: string;
  dropoffAddress?: string;
  driverName?: string;
  date?: string;
}

export const getRideReceiptHtml = (params: RideReceiptEmailParams): string => {
  const fare = ((params.totalFarePaise ?? 0) / 100).toFixed(2);
  const pickup = params.pickupAddress || 'Pickup Point';
  const dropoff = params.dropoffAddress || 'Dropoff Point';
  const rideDate = params.date || new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${APP_NAME} Ride Receipt</title>
<style>${baseStyles}</style>
</head>
<body>
<table role="presentation" class="wrapper" width="100%">
<tr>
<td align="center" class="p-24">
<table role="presentation" class="container">
<tr><td class="header"><span class="brand">${APP_NAME}</span></td></tr>
<tr><td class="p-32">
<h1 class="title">Your Ride Receipt</h1>
<p class="text">Thank you for riding with ${APP_NAME}. Here is the summary of your trip on ${rideDate}:</p>
<table role="presentation" width="100%" style="margin: 20px 0; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
<tr><td style="padding: 8px 0; color: #6b7280;">Ride ID:</td><td align="right" style="font-weight: 600;">${params.rideId}</td></tr>
${params.paymentId ? `<tr><td style="padding: 8px 0; color: #6b7280;">Payment ID:</td><td align="right" style="font-weight: 600;">${params.paymentId}</td></tr>` : ''}
<tr><td style="padding: 8px 0; color: #6b7280;">Pickup:</td><td align="right" style="font-weight: 500;">${pickup}</td></tr>
<tr><td style="padding: 8px 0; color: #6b7280;">Destination:</td><td align="right" style="font-weight: 500;">${dropoff}</td></tr>
<tr style="border-top: 2px solid #e5e7eb;"><td style="padding: 12px 0 0 0; font-size: 16px; font-weight: 700;">Total Paid:</td><td align="right" style="padding: 12px 0 0 0; font-size: 18px; font-weight: 700; color: #059669;">₹${fare}</td></tr>
</table>
<p class="muted">Need help with this ride? Visit our support center or reply to this email.</p>
</td></tr>
<tr><td class="footer">© ${YEAR} ${APP_NAME}. All rights reserved.</td></tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
};
