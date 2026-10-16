import { NotificationRepository } from '../repositories/notification.repository.js';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('notification-dispatcher');

export class NotificationDispatcher {
  private isRunning = false;

  constructor(private notifRepo: NotificationRepository) {}

  start() {
    this.isRunning = true;
    logger.info('Notification Dispatcher started.');
    this.runLoop();
  }

  private async runLoop() {
    while (this.isRunning) {
      try {
        const pending = await this.notifRepo.findPending();
        for (const item of pending) {
          try {
            // Simulated delivery with SendGrid idempotency key (X-Entity-ID)
            logger.info(`Dispatched notification ${item.id} [${item.template}] to ${item.recipient}`);
            await this.notifRepo.markDispatched(item.id, `msg_${item.id.substring(0, 12)}`);
          } catch (err: any) {
            logger.error(`Failed to dispatch notification ${item.id}:`, err);
            await this.notifRepo.recordFailure(item.id, err.message);
          }
        }
      } catch (err) {
        logger.error('Error in dispatch loop:', err);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  stop() {
    this.isRunning = false;
  }
}
