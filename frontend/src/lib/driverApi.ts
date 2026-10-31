import { appApi } from "./api";

export type VehicleType = "CAR" | "BIKE" | "AUTO";

export type DriverVerificationStatus =
  | "PENDING"
  | "UNDER_REVIEW"
  | "VERIFIED"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";

export interface DriverRegistrationResponse {
  id: string;
  verificationStatus: DriverVerificationStatus;
}

export interface DriverProfile {
  id: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  profilePhoto: {
    url: string;
    publicId: string;
  };
  vehicleImages: {
    front: string;
    back: string;
    left: string;
    right: string;
    interior: string;
  };
  vehicle: {
    type: VehicleType;
    brand: string;
    model: string;
    color: string;
    registrationNumber: string;
    registrationYear: number;
  };
  documents: {
    drivingLicense: {
      number: string;
      expiryDate: string;
      frontImage: string;
      backImage: string;
      verified: boolean;
    };
    registrationCertificate: {
      number: string;
      image: string;
      verified: boolean;
    };
    insurance: {
      number: string;
      expiryDate: string;
      image: string;
      verified: boolean;
    };
    pollutionCertificate: {
      expiryDate: string;
      image: string;
    };
  };
  verificationStatus: DriverVerificationStatus;
  isVerified: boolean;
  rating: {
    average: number;
    totalRatings: number;
  };
  statistics: {
    totalTrips: number;
    completedTrips: number;
    cancelledTrips: number;
    totalDistance: number;
    totalEarnings: number;
  };
}

export interface DriverRideItem {
  id: string;
  riderId: string;
  driverId: string | null;
  status: string;
  paymentStatus: string;
  pickup: {
    address: string;
    coordinates?: { latitude: number; longitude: number };
  };
  destination: {
    address: string;
    coordinates?: { latitude: number; longitude: number };
  };
  fare: {
    estimated: number;
    final: number | null;
    breakdown?: {
      driverEarningPaise?: number;
      totalPaise?: number;
      baseFarePaise?: number;
      distanceFarePaise?: number;
      timeFarePaise?: number;
      platformCommissionPaise?: number;
    };
  };
  distance: { estimated: number; actual: number };
  duration: { estimated: number; actual: number | null };
  ratings?: Array<{
    id: string;
    score: number;
    feedback?: string | null;
    createdAt?: string;
  }>;
  createdAt: string;
  completedAt?: string;
}

export function isDriverApproved(
  profile:
    | { verificationStatus?: DriverVerificationStatus; isVerified?: boolean }
    | null
    | undefined
): boolean {
  return Boolean(
    profile?.isVerified &&
      (profile.verificationStatus === "APPROVED" ||
        profile.verificationStatus === "VERIFIED")
  );
}

export async function registerDriver(
    formData: FormData
): Promise<DriverRegistrationResponse> {
    const response = await appApi.post<{
        data: DriverRegistrationResponse;
    }>("/driver/register", formData, {
        headers: {
            "Content-Type": "multipart/form-data",
        },
    });
    return response.data.data;
}

export async function fetchDriverProfile(): Promise<DriverProfile> {
  const response = await appApi.get<{ data: DriverProfile }>('/driver/profile');
  return response.data.data;
}

export async function fetchDriverRideHistory(): Promise<DriverRideItem[]> {
  const response = await appApi.get<{ data: DriverRideItem[]; totalRides?: number }>('/ride/history/driver');
  return response.data.data || [];
}
