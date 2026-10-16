export class OtpService {
  generateRideOtp(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  verifyRideOtp(storedOtp: string | null, enteredOtp: string): boolean {
    if (!storedOtp) return false;
    return storedOtp === enteredOtp;
  }

  invalidateRideOtp(): null {
    return null;
  }
}
