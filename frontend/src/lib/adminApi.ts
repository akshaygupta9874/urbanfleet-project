import { appApi } from './api';

export interface OverviewMetrics {
  users: { total: number; degraded?: boolean };
  drivers: { total: number; degraded?: boolean };
  rides: { total: number; degraded?: boolean };
  payments: { total: number; degraded?: boolean };
  degradedServices?: string[];
}

export interface AdminUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  roles: string[];
  isEmailVerified: boolean;
  isSuspended: boolean;
  suspensionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminVehicle {
  id: string;
  type: string;
  brand: string;
  model: string;
  color: string;
  registrationNumber: string;
  registrationYear: number;
}

export interface AdminDocument {
  id: string;
  type: string;
  status: string;
  documentNumber?: string;
  expiresAt?: string;
  documentUrl?: string;
}

export interface AdminDriver {
  id: string;
  userId: string;
  licenseNumber: string;
  verificationStatus: 'PENDING' | 'UNDER_REVIEW' | 'VERIFIED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  isVerified: boolean;
  isAvailable: boolean;
  vehicles?: AdminVehicle[];
  documents?: AdminDocument[];
  createdAt: string;
  user?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  };
}

export interface AdminRide {
  id: string;
  riderId: string;
  driverId?: string | null;
  pickupAddress: string;
  destinationAddress: string;
  pickupLat?: number;
  pickupLng?: number;
  destinationLat?: number;
  destinationLng?: number;
  status: 'SEARCHING' | 'DRIVER_ASSIGNED' | 'DRIVER_ARRIVING' | 'RIDE_STARTED' | 'STARTED' | 'ARRIVED_AT_DESTINATION' | 'COMPLETED' | 'CANCELLED';
  fare?: {
    estimated?: number;
    final?: number | null;
    breakdown?: {
      totalPaise?: number;
      baseFarePaise?: number;
      distanceFarePaise?: number;
      driverEarningPaise?: number;
      platformCommissionPaise?: number;
    };
  } | null;
  paymentStatus?: 'PENDING' | 'CAPTURED' | 'REFUNDED' | 'FAILED' | null;
  createdAt: string;
}

export interface AdminPayment {
  id: string;
  rideId: string;
  amountPaise: number;
  currency: string;
  status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'FAILED';
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  createdAt: string;
}

export interface AdminSession {
  id: string;
  userId: string;
  userAgent?: string;
  ipAddress?: string;
  deviceType?: 'DESKTOP' | 'MOBILE' | 'TABLET' | 'UNKNOWN';
  browser?: string;
  os?: string;
  expiresAt: string;
  createdAt: string;
  lastActiveAt?: string;
}

export interface AdminAuditLog {
  id: string;
  adminUserId: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  reason: string;
  ipAddress?: string | null;
  createdAt: string;
}

export interface ServiceHealthSummary {
  status: 'UP' | 'DOWN';
  dependencies?: Record<string, string>;
  latencyMs?: number;
}

export interface SystemSettings {
  surgeMultiplier: number;
  autoDriverVerification: boolean;
  maintenanceMode: boolean;
  maintenanceNotice: string;
  sessionTimeoutMins: number;
  maxActiveRidesPerDriver: number;
  updatedAt: string;
  updatedBy?: string;
}

export interface FleetRadarVehicle {
  id: string;
  driverId: string;
  driverName: string;
  licenseNumber: string;
  vehicleType: string;
  vehicleModel: string;
  vehiclePlate: string;
  lat: number;
  lng: number;
  heading: number;
  status: 'AVAILABLE' | 'EN_ROUTE_PICKUP' | 'ON_TRIP' | 'OFFLINE';
  speedKmh: number;
  hasGpsFix: boolean;
  rideId?: string;
  pickupAddress?: string;
  destinationAddress?: string;
  rating: number;
}

export interface AnalyticsSummary {
  period: '24h' | '7d' | '30d';
  revenueTimeline: Array<{
    date: string;
    grossVolumeINR: number;
    platformFeeINR: number;
    ridesCount: number;
    completedRides: number;
  }>;
  rideStatusBreakdown: Record<string, number>;
  driverKycBreakdown: {
    approved: number;
    pending: number;
    rejected: number;
    underReview: number;
    suspended?: number;
    total: number;
  };
  conversionFunnel: {
    requested: number;
    driverMatched: number;
    tripStarted: number;
    tripCompleted: number;
    conversionPercent: number;
  };
  summaryKpis: {
    grossVolumeINR: number;
    netPlatformFeeINR: number;
    completionRatePercent: number;
    avgTripFareINR: number;
    totalRefundsINR: number;
  };
  degradedServices?: string[];
}

export interface PaginatedResult<T> {
  success: boolean;
  data: T[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
  };
}

function maskSensitiveField(key: string, val: unknown): unknown {
  if (typeof val === 'string' && val.length > 0) {
    const k = key.toLowerCase();
    if (k.includes('secret') || k.includes('password') || k.includes('token')) {
      return '[REDACTED]';
    }
    if (k.includes('gateway') || k.includes('order_id') || k.includes('payment_id')) {
      return val.length > 8 ? `${val.slice(0, 4)}...${val.slice(-4)}` : '****';
    }
  }
  return val;
}

// Client-side CSV / JSON export utilities with sensitive credential redaction
export function exportToCsv(filename: string, rows: Record<string, unknown>[], headers?: string[]) {
  if (!rows || rows.length === 0) return;
  const cols = headers || Object.keys(rows[0]);
  const csvContent = [
    cols.join(','),
    ...rows.map(row =>
      cols
        .map(col => {
          const rawVal = row[col];
          const val = maskSensitiveField(col, rawVal);
          if (val === null || val === undefined) return '""';
          const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
          return `"${str.replace(/"/g, '""')}"`;
        })
        .join(',')
    ),
  ].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToJson(filename: string, data: unknown) {
  // Sanitize sensitive tokens before export
  const sanitized = JSON.parse(
    JSON.stringify(data, (key, value) => maskSensitiveField(key, value))
  );
  const jsonContent = JSON.stringify(sanitized, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const adminApi = {
  async getOverview(): Promise<OverviewMetrics> {
    const res = await appApi.get<{ success: boolean; data: OverviewMetrics }>('/admin/overview');
    return res.data.data;
  },

  async getAnalytics(period: '24h' | '7d' | '30d' = '7d'): Promise<AnalyticsSummary> {
    const res = await appApi.get<{ success: boolean; data: AnalyticsSummary }>('/admin/analytics', {
      params: { period },
    });
    return res.data.data;
  },

  async getFleetRadar(signal?: AbortSignal): Promise<FleetRadarVehicle[]> {
    const res = await appApi.get<{ success: boolean; data: FleetRadarVehicle[] }>('/admin/fleet/radar', {
      signal,
    });
    return res.data.data;
  },

  async getSettings(): Promise<SystemSettings> {
    const res = await appApi.get<{ success: boolean; data: SystemSettings }>('/admin/settings');
    return res.data.data;
  },

  async updateSettings(data: {
    surgeMultiplier: number;
    autoDriverVerification: boolean;
    maintenanceMode: boolean;
    maintenanceNotice: string;
    sessionTimeoutMins: number;
    maxActiveRidesPerDriver: number;
    reason: string;
  }): Promise<SystemSettings> {
    const res = await appApi.patch<{ success: boolean; data: SystemSettings }>('/admin/settings', data);
    return res.data.data;
  },

  async getUsers(params: { page?: number; limit?: number; search?: string; role?: string } = {}): Promise<PaginatedResult<AdminUser>> {
    const res = await appApi.get<PaginatedResult<AdminUser>>('/admin/users', { params });
    return res.data;
  },

  async setSuspension(userId: string, suspended: boolean, reason: string): Promise<AdminUser> {
    const res = await appApi.patch<{ success: boolean; data: AdminUser }>(
      `/admin/users/${userId}/suspension`,
      { reason },
      { params: { suspended } }
    );
    return res.data.data;
  },

  async setUserSuspension(userId: string, suspended: boolean, reason: string): Promise<AdminUser> {
    return this.setSuspension(userId, suspended, reason);
  },

  async getDrivers(params: { page?: number; limit?: number; search?: string; status?: string } = {}): Promise<PaginatedResult<AdminDriver>> {
    const res = await appApi.get<PaginatedResult<AdminDriver>>('/admin/drivers', { params });
    return res.data;
  },

  async verifyDriver(driverId: string, status: string, reason: string): Promise<AdminDriver> {
    const res = await appApi.patch<{ success: boolean; data: AdminDriver }>(
      `/admin/drivers/${driverId}/verification`,
      { status, reason }
    );
    return res.data.data;
  },

  async getRides(params: { page?: number; limit?: number; search?: string; status?: string } = {}): Promise<PaginatedResult<AdminRide>> {
    const res = await appApi.get<PaginatedResult<AdminRide>>('/admin/rides', { params });
    return res.data;
  },

  async getPayments(params: { page?: number; limit?: number; search?: string; status?: string } = {}): Promise<PaginatedResult<AdminPayment>> {
    const res = await appApi.get<PaginatedResult<AdminPayment>>('/admin/payments', { params });
    return res.data;
  },

  async refundPayment(paymentId: string, reason: string, amountPaise?: number, idempotencyKey?: string): Promise<{ success: boolean; status: string }> {
    const res = await appApi.post<{ success: boolean; status: string }>(
      `/admin/payments/${paymentId}/refund`,
      { reason, amountPaise },
      { headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }
    );
    return res.data;
  },

  async getSessions(params: { page?: number; limit?: number; userId?: string } = {}): Promise<PaginatedResult<AdminSession>> {
    const res = await appApi.get<PaginatedResult<AdminSession>>('/admin/sessions', { params });
    return res.data;
  },

  async revokeSession(sessionId: string): Promise<{ success: boolean }> {
    const res = await appApi.delete<{ success: boolean }>(`/admin/sessions/${sessionId}`);
    return res.data;
  },

  async getAuditLogs(params: { page?: number; limit?: number } = {}): Promise<PaginatedResult<AdminAuditLog>> {
    const res = await appApi.get<PaginatedResult<AdminAuditLog>>('/admin/audit', { params });
    return res.data;
  },

  async getSystemHealth(): Promise<Record<string, ServiceHealthSummary>> {
    const res = await appApi.get<{ success: boolean; data: Record<string, ServiceHealthSummary> }>('/admin/system-health');
    return res.data.data;
  },
};
