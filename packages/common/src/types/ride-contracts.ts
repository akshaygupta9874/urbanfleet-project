export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface LocationPoint {
  address: string;
  coordinates: Coordinates;
}

export interface IFareBreakdown {
  baseFarePaise: number;
  distanceFarePaise: number;
  timeFarePaise: number;
  surgePaise: number;
  platformCommissionPaise: number;
  driverEarningPaise: number;
  totalPaise: number;
}

export interface FormattedDriver {
  id: string;
  firstName: string;
  lastName: string;
  vehicleNumber: string;
  email: string;
  phone?: string;
  profilePhoto?: string | null;
  rating?: number;
  totalTrips?: number;
  user: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
  vehicle: {
    registrationNumber: string;
    plateNumber?: string;
    brand?: string;
    make?: string;
    model: string;
    color: string;
    type?: string;
  };
}

export interface RideDto {
  id: string;
  riderId: string;
  driverId: string | null;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  pickup: LocationPoint;
  destination: LocationPoint;
  fare: {
    estimated: number;
    final: number | null;
    breakdown: IFareBreakdown;
  };
  distance: {
    estimated: number;
    actual: number;
  };
  duration: {
    estimated: number;
    actual: number | null;
  };
  status: string;
  paymentStatus: string;
  vehicleCategory?: string;
  vehicleType?: string;
  driver: FormattedDriver | null;
  ratings?: Array<{ id: string; score: number; feedback?: string | null; createdAt?: string }>;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
