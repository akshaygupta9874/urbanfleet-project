import { appApi } from "./api";

export type VehicleType = "CAR" | "BIKE" | "AUTO";

export interface DriverRegistrationResponse {
  id: string;
  verificationStatus: "PENDING" | "APPROVED" | "REJECTED";
}

export interface DriverProfile {
  _id: string;
  user: {
    _id: string;
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
  verificationStatus: "PENDING" | "APPROVED" | "REJECTED";
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
