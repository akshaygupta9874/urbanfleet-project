import crypto from 'crypto';

export class OtpService {
  generateRideOtp(): string {
    return crypto.randomInt(1000, 10000).toString();
  }

  verifyRideOtp(storedOtp: string | null, enteredOtp: string): boolean {
    if (!storedOtp || !enteredOtp) return false;
    if (storedOtp.length !== enteredOtp.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(storedOtp), Buffer.from(enteredOtp));
    } catch {
      return storedOtp === enteredOtp;
    }
  }

  invalidateRideOtp(): null {
    return null;
  }
}

