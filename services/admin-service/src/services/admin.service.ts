import axios from 'axios';
import { authClient, AuthClient } from '../clients/auth.client.js';
import { driverClient, DriverClient } from '../clients/driver.client.js';
import { rideClient, RideClient } from '../clients/ride.client.js';
import { paymentClient, PaymentClient } from '../clients/payment.client.js';
import { adminRedisClient } from '../redis/client.js';
import { config } from '../config/config.js';
import type {
  DriverVerificationInput,
  PaginationQuery,
  RefundRequestInput,
  SystemSettingsInput,
  UserSuspensionInput,
} from '../validation/admin.validation.js';

export interface OverviewMetrics {
  users: { total: number; degraded?: boolean };
  drivers: { total: number; degraded?: boolean };
  rides: { total: number; degraded?: boolean };
  payments: { total: number; degraded?: boolean };
  degradedServices?: string[];
}

export interface ServiceHealthSummary {
  status: 'UP' | 'DOWN';
  dependencies?: Record<string, string>;
  latencyMs?: number;
}

export interface SystemSettingsState {
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
    suspended: number;
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

const SETTINGS_REDIS_KEY = 'urbanfleet:system:settings';

export class AdminService {
  private settings: SystemSettingsState = {
    surgeMultiplier: 1.0,
    autoDriverVerification: false,
    maintenanceMode: false,
    maintenanceNotice: 'Scheduled platform maintenance in progress. Services will resume shortly.',
    sessionTimeoutMins: 1440,
    maxActiveRidesPerDriver: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: 'system-initialization',
  };

  constructor(
    private readonly auth: AuthClient = authClient,
    private readonly driver: DriverClient = driverClient,
    private readonly ride: RideClient = rideClient,
    private readonly payment: PaymentClient = paymentClient
  ) {
    void this.initializeSettingsFromRedis();
  }

  private async initializeSettingsFromRedis(): Promise<void> {
    try {
      if (adminRedisClient && adminRedisClient.isOpen) {
        const stored = await adminRedisClient.get(SETTINGS_REDIS_KEY);
        if (stored) {
          this.settings = { ...this.settings, ...JSON.parse(stored) };
          console.log('[admin-service] Loaded system settings from Redis cluster');
        }
      }
    } catch (err) {
      console.warn('[admin-service] Could not read settings from Redis on boot:', err);
    }
  }

  async getOverview(bearer?: string): Promise<OverviewMetrics> {
    const degradedServices: string[] = [];

    const [usersRes, driversRes, ridesRes, paymentsRes] = await Promise.all([
      this.auth.getUsers(bearer, { limit: 1 }).catch(() => {
        degradedServices.push('auth-service');
        return { data: { pagination: { total: 0 } } };
      }),
      this.driver.getDrivers(bearer, { limit: 1 }).catch(() => {
        degradedServices.push('driver-service');
        return { data: { pagination: { total: 0 } } };
      }),
      this.ride.getRides(bearer, { limit: 1 }).catch(() => {
        degradedServices.push('ride-service');
        return { data: { pagination: { total: 0 } } };
      }),
      this.payment.getPayments(bearer, { limit: 1 }).catch(() => {
        degradedServices.push('payment-service');
        return { data: { pagination: { total: 0 } } };
      }),
    ]);

    return {
      users: {
        total: (usersRes as any).data?.pagination?.total ?? 0,
        degraded: degradedServices.includes('auth-service'),
      },
      drivers: {
        total: (driversRes as any).data?.pagination?.total ?? 0,
        degraded: degradedServices.includes('driver-service'),
      },
      rides: {
        total: (ridesRes as any).data?.pagination?.total ?? 0,
        degraded: degradedServices.includes('ride-service'),
      },
      payments: {
        total: (paymentsRes as any).data?.pagination?.total ?? 0,
        degraded: degradedServices.includes('payment-service'),
      },
      degradedServices: degradedServices.length > 0 ? degradedServices : undefined,
    };
  }

  async getUsers(bearer: string | undefined, query: PaginationQuery) {
    const res = await this.auth.getUsers(bearer, query);
    return res.data;
  }

  async getSessions(bearer: string | undefined, query: PaginationQuery) {
    const res = await this.auth.getSessions(bearer, query);
    return res.data;
  }

  async revokeSession(bearer: string | undefined, sessionId: string) {
    const res = await this.auth.revokeSession(bearer, sessionId);
    await this.auth.recordAudit(bearer, {
      action: 'SESSION_REVOKED',
      resource: 'SESSION',
      resourceId: sessionId,
      reason: 'Revoked by administrator from operations console',
    }).catch(() => undefined);
    return res.data;
  }

  async setSuspension(bearer: string | undefined, userId: string, suspended: boolean, input: UserSuspensionInput) {
    const res = await this.auth.setSuspension(bearer, userId, suspended, input.reason);
    await this.auth.recordAudit(bearer, {
      action: suspended ? 'USER_SUSPENDED' : 'USER_RESTORED',
      resource: 'USER',
      resourceId: userId,
      reason: input.reason,
    }).catch(() => undefined);
    return res.data;
  }

  async getDrivers(bearer: string | undefined, query: PaginationQuery) {
    const res = await this.driver.getDrivers(bearer, query);
    return res.data;
  }

  async verifyDriver(bearer: string | undefined, driverId: string, input: DriverVerificationInput) {
    const res = await this.driver.updateVerification(bearer, driverId, input.status, input.reason);
    await this.auth.recordAudit(bearer, {
      action: `DRIVER_${input.status}`,
      resource: 'DRIVER',
      resourceId: driverId,
      reason: input.reason,
    }).catch(() => undefined);
    return res.data;
  }

  async getRides(bearer: string | undefined, query: PaginationQuery) {
    const res = await this.ride.getRides(bearer, query);
    return res.data;
  }

  async getPayments(bearer: string | undefined, query: PaginationQuery) {
    const res = await this.payment.getPayments(bearer, query);
    return res.data;
  }

  async refundPayment(bearer: string | undefined, paymentId: string, input: RefundRequestInput, idempotencyKey?: string) {
    const refundArgs: any[] = [bearer, paymentId, input.reason, input.amountPaise];
    if (idempotencyKey !== undefined) {
      refundArgs.push(idempotencyKey);
    }
    const res = await (this.payment.refundPayment as any)(...refundArgs);
    await this.auth.recordAudit(bearer, {
      action: 'REFUND_REQUESTED',
      resource: 'PAYMENT',
      resourceId: paymentId,
      reason: input.reason,
    }).catch(() => undefined);
    return res.data;
  }

  async getAuditLogs(bearer: string | undefined, query: PaginationQuery) {
    const res = await this.auth.getAuditLogs(bearer, query);
    return res.data;
  }

  async recordAudit(bearer: string | undefined, payload: { action: string; resource: string; resourceId?: string; reason: string }) {
    const res = await (this.auth as any).recordAudit(bearer, payload);
    return res.data;
  }

  getSettings(): SystemSettingsState {
    return { ...this.settings };
  }

  async updateSettings(bearer: string | undefined, input: SystemSettingsInput, adminUserId?: string) {
    this.settings = {
      surgeMultiplier: input.surgeMultiplier,
      autoDriverVerification: input.autoDriverVerification,
      maintenanceMode: input.maintenanceMode,
      maintenanceNotice: input.maintenanceNotice,
      sessionTimeoutMins: input.sessionTimeoutMins,
      maxActiveRidesPerDriver: input.maxActiveRidesPerDriver,
      updatedAt: new Date().toISOString(),
      updatedBy: adminUserId || 'administrator',
    };

    try {
      if (adminRedisClient && adminRedisClient.isOpen) {
        await adminRedisClient.set(SETTINGS_REDIS_KEY, JSON.stringify(this.settings));
      }
    } catch (err) {
      console.warn('[admin-service] Could not persist settings to Redis:', err);
    }

    await this.auth.recordAudit(bearer, {
      action: 'SYSTEM_CONFIG_UPDATED',
      resource: 'SYSTEM',
      resourceId: 'global-settings',
      reason: input.reason,
    }).catch(() => undefined);

    return { ...this.settings };
  }

  async getAnalytics(bearer?: string, period: '24h' | '7d' | '30d' = '7d'): Promise<AnalyticsSummary> {
    const degradedServices: string[] = [];
    const hasRideMetrics = typeof (this.ride as any).getMetrics === 'function';
    const hasPaymentMetrics = typeof (this.payment as any).getMetrics === 'function';
    const hasDriverMetrics = typeof (this.driver as any).getMetrics === 'function';

    const [rideMetricsRes, paymentMetricsRes, driverMetricsRes, fallbackRidesRes, fallbackPaymentsRes, fallbackDriversRes] = await Promise.all([
      hasRideMetrics ? this.ride.getMetrics(bearer, period).catch(() => null) : Promise.resolve(null),
      hasPaymentMetrics ? this.payment.getMetrics(bearer, period).catch(() => null) : Promise.resolve(null),
      hasDriverMetrics ? this.driver.getMetrics(bearer).catch(() => null) : Promise.resolve(null),
      !hasRideMetrics ? this.ride.getRides(bearer, { limit: 100 }).catch(() => ({ data: { data: [] } })) : Promise.resolve(null),
      !hasPaymentMetrics ? this.payment.getPayments(bearer, { limit: 100 }).catch(() => ({ data: { data: [] } })) : Promise.resolve(null),
      !hasDriverMetrics ? this.driver.getDrivers(bearer, { limit: 100 }).catch(() => ({ data: { data: [] } })) : Promise.resolve(null),
    ]);

    const rideMetrics = (rideMetricsRes as any)?.data?.data;
    const paymentMetrics = (paymentMetricsRes as any)?.data?.data;
    const driverMetrics = (driverMetricsRes as any)?.data?.data;

    const fallbackRides = (fallbackRidesRes as any)?.data?.data || [];
    const fallbackPayments = (fallbackPaymentsRes as any)?.data?.data || [];
    const fallbackDrivers = (fallbackDriversRes as any)?.data?.data || [];

    // Timeline calculation based on period
    const numDays = period === '24h' ? 1 : period === '30d' ? 30 : 7;
    const now = new Date();
    const timelineMap: Record<string, { grossVolumeINR: number; platformFeeINR: number; ridesCount: number; completedRides: number }> = {};

    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      timelineMap[key] = { grossVolumeINR: 0, platformFeeINR: 0, ridesCount: 0, completedRides: 0 };
    }

    let totalGrossPaise = paymentMetrics?.grossVolumePaise ?? 0;
    let totalRefundsPaise = paymentMetrics?.refundedVolumePaise ?? 0;

    if (!paymentMetrics && fallbackPayments.length > 0) {
      fallbackPayments.forEach((p: any) => {
        const dateKey = new Date(p.createdAt || now).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const amountINR = (p.amountPaise || 0) / 100;
        if (p.status === 'CAPTURED' || p.status === 'SUCCESS') {
          totalGrossPaise += p.amountPaise || 0;
          if (timelineMap[dateKey]) {
            timelineMap[dateKey].grossVolumeINR += amountINR;
            timelineMap[dateKey].platformFeeINR += amountINR * 0.15;
          }
        } else if (p.status === 'REFUNDED') {
          totalRefundsPaise += p.amountPaise || 0;
        }
      });
    }

    const grossVolumeINR = Math.round(totalGrossPaise / 100);
    const netPlatformFeeINR = Math.round(grossVolumeINR * 0.15); // 15% platform take rate

    // Distribute smoothly if granular timeline buckets weren't populated
    const timelineKeys = Object.keys(timelineMap);
    const hasTimelineData = Object.values(timelineMap).some((v) => v.grossVolumeINR > 0);
    if (!hasTimelineData && timelineKeys.length > 0 && grossVolumeINR > 0) {
      const avgDayGross = grossVolumeINR / timelineKeys.length;
      const avgDayFee = netPlatformFeeINR / timelineKeys.length;
      const avgDayRides = Math.round(((rideMetrics?.totalRides || fallbackRides.length) ?? 0) / timelineKeys.length);
      const avgDayCompleted = Math.round(((rideMetrics?.completedRides || fallbackRides.filter((r: any) => r.status === 'COMPLETED').length) ?? 0) / timelineKeys.length);
      for (const k of timelineKeys) {
        timelineMap[k] = {
          grossVolumeINR: Math.round(avgDayGross),
          platformFeeINR: Math.round(avgDayFee),
          ridesCount: avgDayRides,
          completedRides: avgDayCompleted,
        };
      }
    }

    const rideStatusBreakdown: Record<string, number> = {
      SEARCHING: 0,
      DRIVER_ASSIGNED: 0,
      DRIVER_ARRIVING: 0,
      RIDE_STARTED: 0,
      ARRIVED_AT_DESTINATION: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      ...(rideMetrics?.statusBreakdown || {}),
    };

    if (!rideMetrics && fallbackRides.length > 0) {
      fallbackRides.forEach((r: any) => {
        const st = r.status || 'SEARCHING';
        rideStatusBreakdown[st] = (rideStatusBreakdown[st] || 0) + 1;
      });
    }

    const totalRides = rideMetrics?.totalRides || fallbackRides.length || (Object.values(rideStatusBreakdown).reduce((a, b) => a + b, 0) || 1);
    const completedRidesCount = rideMetrics?.completedRides ?? (rideStatusBreakdown.COMPLETED || fallbackRides.filter((r: any) => r.status === 'COMPLETED').length);
    const tripStartedCount = (rideStatusBreakdown.RIDE_STARTED || 0) + (rideStatusBreakdown.ARRIVED_AT_DESTINATION || 0) + (rideStatusBreakdown.COMPLETED || 0);
    const driverMatchedCount = tripStartedCount + (rideStatusBreakdown.DRIVER_ASSIGNED || 0) + (rideStatusBreakdown.DRIVER_ARRIVING || 0);

    const completionRatePercent = totalRides > 0 ? Math.round((completedRidesCount / totalRides) * 100) : 0;
    const avgTripFareINR = completedRidesCount > 0 ? Math.round(grossVolumeINR / completedRidesCount) : 0;

    const driverKycBreakdown = {
      approved: driverMetrics?.approved ?? fallbackDrivers.filter((d: any) => d.verificationStatus === 'APPROVED' || d.isVerified).length,
      pending: driverMetrics?.pending ?? fallbackDrivers.filter((d: any) => d.verificationStatus === 'PENDING').length,
      rejected: driverMetrics?.rejected ?? fallbackDrivers.filter((d: any) => d.verificationStatus === 'REJECTED').length,
      underReview: driverMetrics?.underReview ?? fallbackDrivers.filter((d: any) => d.verificationStatus === 'UNDER_REVIEW').length,
      suspended: driverMetrics?.suspended ?? fallbackDrivers.filter((d: any) => d.verificationStatus === 'SUSPENDED').length,
      total: driverMetrics?.total ?? fallbackDrivers.length,
    };

    return {
      period,
      revenueTimeline: Object.entries(timelineMap).map(([date, val]) => ({
        date,
        grossVolumeINR: Math.round(val.grossVolumeINR),
        platformFeeINR: Math.round(val.platformFeeINR),
        ridesCount: val.ridesCount,
        completedRides: val.completedRides,
      })),
      rideStatusBreakdown,
      driverKycBreakdown,
      conversionFunnel: {
        requested: totalRides,
        driverMatched: driverMatchedCount,
        tripStarted: tripStartedCount,
        tripCompleted: completedRidesCount,
        conversionPercent: completionRatePercent,
      },
      summaryKpis: {
        grossVolumeINR,
        netPlatformFeeINR,
        completionRatePercent,
        avgTripFareINR,
        totalRefundsINR: Math.round(totalRefundsPaise / 100),
      },
      degradedServices: degradedServices.length > 0 ? degradedServices : undefined,
    };
  }

  async getFleetRadar(bearer?: string): Promise<FleetRadarVehicle[]> {
    const [ridesRes, driversRes] = await Promise.all([
      this.ride.getRides(bearer, { limit: 100 }).catch(() => ({ data: { data: [] } })),
      this.driver.getDrivers(bearer, { limit: 100 }).catch(() => ({ data: { data: [] } })),
    ]);

    const rides = (ridesRes as any).data?.data || [];
    const drivers = (driversRes as any).data?.data || [];

    const fleet: FleetRadarVehicle[] = [];

    for (const driver of drivers) {
      const activeRide = rides.find(
        (r: any) =>
          r.driverId === driver.userId || r.driverId === driver.id
      );

      const vehicle = driver.vehicles?.[0] || null;

      let lat = 0;
      let lng = 0;
      let hasGpsFix = false;
      let status: 'AVAILABLE' | 'EN_ROUTE_PICKUP' | 'ON_TRIP' | 'OFFLINE' = driver.isAvailable ? 'AVAILABLE' : 'OFFLINE';
      let speedKmh = 0;

      if (activeRide) {
        lat = Number(activeRide.pickupLat) || Number(activeRide.destinationLat) || 0;
        lng = Number(activeRide.pickupLng) || Number(activeRide.destinationLng) || 0;
        hasGpsFix = Boolean(lat !== 0 && lng !== 0);

        if (activeRide.status === 'RIDE_STARTED' || activeRide.status === 'STARTED' || activeRide.status === 'ARRIVED_AT_DESTINATION') {
          status = 'ON_TRIP';
          speedKmh = 38;
        } else if (activeRide.status === 'DRIVER_ASSIGNED' || activeRide.status === 'DRIVER_ARRIVING') {
          status = 'EN_ROUTE_PICKUP';
          speedKmh = 26;
        }
      } else {
        if (adminRedisClient && adminRedisClient.isOpen) {
          try {
            const driverKey = driver.id || driver.userId;
            const pos = await adminRedisClient.geoPos('geo:drivers', driverKey);
            if (pos && pos[0]) {
              lat = Number(pos[0].latitude);
              lng = Number(pos[0].longitude);
              hasGpsFix = true;
            }
          } catch {}
        }
      }

      const driverName = driver.user
        ? `${driver.user.firstName || ''} ${driver.user.lastName || ''}`.trim() || 'UrbanFleet Driver'
        : 'UrbanFleet Driver';

      fleet.push({
        id: `radar-veh-${driver.id}`,
        driverId: driver.id || driver.userId,
        driverName,
        licenseNumber: driver.licenseNumber || 'N/A',
        vehicleType: vehicle?.category || vehicle?.type || 'SEDAN',
        vehicleModel: vehicle ? `${vehicle.make || vehicle.brand || ''} ${vehicle.model || ''}`.trim() : 'Unregistered',
        vehiclePlate: vehicle?.plateNumber || vehicle?.registrationNumber || 'N/A',
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
        heading: 0,
        status,
        speedKmh: status === 'AVAILABLE' || status === 'OFFLINE' ? 0 : speedKmh,
        hasGpsFix,
        rideId: activeRide?.id,
        pickupAddress: activeRide?.pickupAddress,
        destinationAddress: activeRide?.destinationAddress,
        rating: Number(driver.statistics?.ratingAverage ?? 5.0),
      });
    }

    return fleet;
  }

  async getSystemHealth(): Promise<Record<string, ServiceHealthSummary>> {
    const targets = Object.entries(config.services);
    const checks = await Promise.all(
      targets.map(async ([name, baseURL]) => {
        const start = Date.now();
        try {
          const result = await axios.get(`${baseURL}/health`, { timeout: 3000 });
          const latencyMs = Date.now() - start;
          return [
            name,
            {
              status: (result.data?.status || 'UP') as 'UP' | 'DOWN',
              dependencies: result.data?.dependencies || {},
              latencyMs,
            },
          ] as const;
        } catch {
          return [
            name,
            {
              status: 'DOWN' as const,
              dependencies: {},
              latencyMs: Date.now() - start,
            },
          ] as const;
        }
      })
    );

    return Object.fromEntries(checks);
  }
}

export const adminService = new AdminService();
