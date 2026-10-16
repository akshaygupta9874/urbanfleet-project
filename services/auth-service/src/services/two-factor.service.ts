import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import { UserRepository } from '../repositories/user.repository.js';
import { NotFoundError, UnauthorizedError } from '@urbanfleet/common';

export class TwoFactorService {
  constructor(private userRepo: UserRepository) {}

  async generateSecret(userId: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, 'UrbanFleet', secret);
    const qrCodeUrl = await qrcode.toDataURL(otpauth);

    await this.userRepo.update(userId, { twoFactorSecret: secret });

    return { secret, qrCodeUrl };
  }

  async verifyToken(userId: string, token: string): Promise<boolean> {
    const user = await this.userRepo.findById(userId);
    if (!user || !user.twoFactorSecret) return false;
    return authenticator.verify({ token, secret: user.twoFactorSecret });
  }

  async enable2FA(userId: string, token: string) {
    const isValid = await this.verifyToken(userId, token);
    if (!isValid) throw new UnauthorizedError('Invalid 2FA verification code');
    await this.userRepo.update(userId, { twoFactorEnabled: true });
    return { success: true };
  }

  async disable2FA(userId: string, token: string) {
    const isValid = await this.verifyToken(userId, token);
    if (!isValid) throw new UnauthorizedError('Invalid 2FA verification code');
    await this.userRepo.update(userId, { twoFactorEnabled: false, twoFactorSecret: null });
    return { success: true };
  }
}
