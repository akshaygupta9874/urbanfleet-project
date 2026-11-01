import { describe, it, expect, vi } from 'vitest';
import { AdminService } from '../src/services/admin.service.js';

describe('AdminService', () => {
  const mockAuthClient: any = {
    getUsers: vi.fn().mockResolvedValue({
      data: {
        success: true,
        data: [{ id: 'usr-1', email: 'test@urbanfleet.com' }],
        pagination: { total: 12 },
      },
    }),
    getSessions: vi.fn().mockResolvedValue({
      data: {
        success: true,
        data: [{ id: 'sess-1' }],
        pagination: { total: 3 },
      },
    }),
    revokeSession: vi.fn().mockResolvedValue({ data: { success: true } }),
    setSuspension: vi.fn().mockResolvedValue({ data: { success: true, isSuspended: true } }),
    getAuditLogs: vi.fn().mockResolvedValue({
      data: {
        success: true,
        data: [{ id: 'audit-1', action: 'USER_SUSPENDED' }],
        pagination: { total: 1 },
      },
    }),
    recordAudit: vi.fn().mockResolvedValue({ data: { success: true } }),
  };

  const mockDriverClient: any = {
    getDrivers: vi.fn().mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            id: 'drv-1',
            userId: 'usr-drv-1',
            verificationStatus: 'PENDING',
            licenseNumber: 'DL-01-2024',
            isAvailable: true,
            vehicles: [{ type: 'SEDAN', brand: 'Hyundai', model: 'Aura', registrationNumber: 'KA 05 UF 1001' }],
          },
        ],
        pagination: { total: 5 },
      },
    }),
    updateVerification: vi.fn().mockResolvedValue({
      data: { success: true, verificationStatus: 'APPROVED' },
    }),
  };

  const mockRideClient: any = {
    getRides: vi.fn().mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            id: 'ride-1',
            status: 'COMPLETED',
            pickupAddress: 'MG Road',
            destinationAddress: 'Indiranagar',
            pickupLat: 12.9716,
            pickupLng: 77.5946,
            driverId: 'usr-drv-1',
          },
        ],
        pagination: { total: 20 },
      },
    }),
  };

  const mockPaymentClient: any = {
    getPayments: vi.fn().mockResolvedValue({
      data: {
        success: true,
        data: [{ id: 'pay-1', status: 'CAPTURED', amountPaise: 45000 }],
        pagination: { total: 18 },
      },
    }),
    refundPayment: vi.fn().mockResolvedValue({
      data: { success: true, status: 'REFUNDED' },
    }),
  };

  const service = new AdminService(
    mockAuthClient,
    mockDriverClient,
    mockRideClient,
    mockPaymentClient
  );

  it('aggregates overview metrics across services', async () => {
    const overview = await service.getOverview('mock-token');
    expect(overview.users.total).toBe(12);
    expect(overview.drivers.total).toBe(5);
    expect(overview.rides.total).toBe(20);
    expect(overview.payments.total).toBe(18);
  });

  it('delegates user listing with pagination query', async () => {
    const res = await service.getUsers('mock-token', { page: 1, limit: 10 });
    expect(mockAuthClient.getUsers).toHaveBeenCalledWith('mock-token', { page: 1, limit: 10 });
    expect(res.data).toHaveLength(1);
  });

  it('updates driver verification and audits the action', async () => {
    const res = await service.verifyDriver('mock-token', 'drv-1', {
      status: 'APPROVED',
      reason: 'Driver documents verified manually',
    });
    expect(mockDriverClient.updateVerification).toHaveBeenCalledWith(
      'mock-token',
      'drv-1',
      'APPROVED',
      'Driver documents verified manually'
    );
    expect(mockAuthClient.recordAudit).toHaveBeenCalledWith('mock-token', {
      action: 'DRIVER_APPROVED',
      resource: 'DRIVER',
      resourceId: 'drv-1',
      reason: 'Driver documents verified manually',
    });
    expect(res.verificationStatus).toBe('APPROVED');
  });

  it('suspends user and audits the action', async () => {
    await service.setSuspension('mock-token', 'usr-1', true, {
      reason: 'Terms of service violation',
    });
    expect(mockAuthClient.setSuspension).toHaveBeenCalledWith(
      'mock-token',
      'usr-1',
      true,
      'Terms of service violation'
    );
    expect(mockAuthClient.recordAudit).toHaveBeenCalledWith('mock-token', {
      action: 'USER_SUSPENDED',
      resource: 'USER',
      resourceId: 'usr-1',
      reason: 'Terms of service violation',
    });
  });

  it('requests refund and audits the action', async () => {
    await service.refundPayment('mock-token', 'pay-1', {
      reason: 'Driver no-show',
      amountPaise: 25000,
    });
    expect(mockPaymentClient.refundPayment).toHaveBeenCalledWith(
      'mock-token',
      'pay-1',
      'Driver no-show',
      25000
    );
    expect(mockAuthClient.recordAudit).toHaveBeenCalledWith('mock-token', {
      action: 'REFUND_REQUESTED',
      resource: 'PAYMENT',
      resourceId: 'pay-1',
      reason: 'Driver no-show',
    });
  });

  it('computes analytics and timeline accurately', async () => {
    const analytics = await service.getAnalytics('mock-token', '7d');
    expect(analytics.period).toBe('7d');
    expect(analytics.summaryKpis.grossVolumeINR).toBe(450);
    expect(analytics.summaryKpis.netPlatformFeeINR).toBe(68);
    expect(analytics.conversionFunnel.tripCompleted).toBe(1);
    expect(analytics.driverKycBreakdown.pending).toBe(1);
    expect(analytics.revenueTimeline).toHaveLength(7);
  });

  it('manages system settings and audits changes', async () => {
    const initial = service.getSettings();
    expect(initial.surgeMultiplier).toBe(1.0);

    const updated = await service.updateSettings('mock-token', {
      surgeMultiplier: 1.5,
      autoDriverVerification: true,
      maintenanceMode: false,
      maintenanceNotice: 'Maintenance complete',
      sessionTimeoutMins: 720,
      maxActiveRidesPerDriver: 2,
      reason: 'Peak hour surge activation',
    }, 'admin-super-id');

    expect(updated.surgeMultiplier).toBe(1.5);
    expect(updated.autoDriverVerification).toBe(true);
    expect(updated.updatedBy).toBe('admin-super-id');
    expect(mockAuthClient.recordAudit).toHaveBeenCalledWith('mock-token', {
      action: 'SYSTEM_CONFIG_UPDATED',
      resource: 'SYSTEM',
      resourceId: 'global-settings',
      reason: 'Peak hour surge activation',
    });
  });

  it('aggregates live dispatch radar fleet data', async () => {
    const fleet = await service.getFleetRadar('mock-token');
    expect(fleet).toHaveLength(1);
    expect(fleet[0].driverId).toBe('drv-1');
    expect(fleet[0].vehicleType).toBe('SEDAN');
    expect(fleet[0].lat).toBe(12.9716);
    expect(fleet[0].lng).toBe(77.5946);
  });
});
