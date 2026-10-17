import { Request, Response } from 'express';
import { AdminService } from '../services/admin.service.js';
import asyncHandler from '../middlewares/asyncHandler.js';

export class AdminController {
  constructor(private adminService: AdminService) {}

  getSystemStats = asyncHandler(async (req: Request, res: Response) => {
    const stats = await this.adminService.getSystemStats();
    res.status(200).json({ success: true, data: stats });
  });
}
