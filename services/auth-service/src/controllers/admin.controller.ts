import { Request, Response, NextFunction } from 'express';
import { AdminService } from '../services/admin.service.js';

export class AdminController {
  constructor(private adminService: AdminService) {}

  getSystemStats = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await this.adminService.getSystemStats();
      res.status(200).json({ success: true, data: stats });
    } catch (err) { next(err); }
  };
}
