export interface IRide {
  id: string;
  riderId: string;
  driverId?: string | null;
  status: string;
  farePaise?: number;
  [key: string]: any;
}

export function formatRide(ride: any): any {
  if (!ride) return null;
  return {
    ...ride,
    id: ride.id || ride._id,
    _id: ride.id || ride._id,
    riderId: ride.riderId ?? ride.rider_id ?? (typeof ride.rider === "object" ? (ride.rider?.id || ride.rider?._id) : ride.rider),
    driverId: ride.driverId ?? ride.driver_id ?? (typeof ride.driver === "object" ? (ride.driver?.id || ride.driver?._id) : ride.driver),
  };
}
