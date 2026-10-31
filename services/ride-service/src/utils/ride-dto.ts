import { Ride } from '../db/client.js';
import { FormattedDriver, IFareBreakdown, RideDto } from '@urbanfleet/common';
import { driverClient, DriverProfile } from '../clients/driver.client.js';

export function toRideDto(ride: Ride, driverInfo?: DriverProfile | null): RideDto;
export function toRideDto(ride: null, driverInfo?: DriverProfile | null): null;
export function toRideDto(ride: Ride | null, driverInfo?: DriverProfile | null): RideDto | null;
export function toRideDto(ride: Ride | null, driverInfo?: DriverProfile | null): RideDto | null {
  if (!ride) return null;

  const pickupLat = Number(ride.pickupLat);
  const pickupLng = Number(ride.pickupLng);
  const destinationLat = Number(ride.destinationLat);
  const destinationLng = Number(ride.destinationLng);
  const totalFarePaise = ride.totalFarePaise;
  const baseFarePaise = ride.baseFarePaise || (totalFarePaise > 0 ? Math.round(totalFarePaise * 0.4) : 0);
  const distanceKm = Number(ride.distanceKm);
  const distanceFarePaise = Math.round(distanceKm * 500);
  const timeFarePaise = Math.max(0, totalFarePaise - baseFarePaise - distanceFarePaise);
  const driverEarningPaise = Math.round(totalFarePaise * 0.8);
  const platformCommissionPaise = totalFarePaise - driverEarningPaise;

  const breakdown: IFareBreakdown = {
    baseFarePaise,
    distanceFarePaise,
    timeFarePaise,
    surgePaise: 0,
    platformCommissionPaise,
    driverEarningPaise,
    totalPaise: totalFarePaise,
  };

  const pickupAddress = ride.pickupAddress || 'Pickup Location';
  const destinationAddress = ride.destinationAddress || 'Destination Location';

  let formattedDriver: FormattedDriver | null = null;
  if (ride.driverId) {
    const activeVehicle = driverInfo?.vehicle || (driverInfo?.vehicles && driverInfo.vehicles[0]);
    const vehiclePlate = driverInfo?.vehicleNumber || activeVehicle?.plateNumber || activeVehicle?.registrationNumber || '';
    const rawPhoto = driverInfo?.profilePhoto;
    const photoUrl = typeof rawPhoto === 'string'
      ? rawPhoto
      : (rawPhoto && typeof rawPhoto === 'object' ? ((rawPhoto as any).secure_url || (rawPhoto as any).url) : (driverInfo?.profilePhotoUrl || null));
    const driverFirstName = driverInfo?.firstName || driverInfo?.user?.firstName || 'Captain';
    const driverLastName = driverInfo?.lastName || driverInfo?.user?.lastName || '';
    const driverEmail = driverInfo?.email || driverInfo?.user?.email || '';
    const driverPhone = driverInfo?.phone || driverInfo?.user?.phone || '';
    const driverRating = typeof driverInfo?.rating === 'number' ? driverInfo.rating : 4.9;

    formattedDriver = {
      id: ride.driverId,
      firstName: driverFirstName,
      lastName: driverLastName,
      vehicleNumber: vehiclePlate,
      email: driverEmail,
      phone: driverPhone,
      profilePhoto: photoUrl,
      rating: driverRating,
      totalTrips: driverInfo?.totalTrips || 0,
      user: {
        firstName: driverFirstName,
        lastName: driverLastName,
        email: driverEmail,
        phone: driverPhone,
      },
      vehicle: {
        registrationNumber: vehiclePlate,
        plateNumber: vehiclePlate,
        brand: activeVehicle?.brand || activeVehicle?.make || '',
        make: activeVehicle?.brand || activeVehicle?.make || '',
        model: activeVehicle?.model || '',
        color: activeVehicle?.color || '',
        type: activeVehicle?.type || activeVehicle?.category || ride.vehicleCategory || 'SEDAN',
      },
    };
  }

  return {
    id: ride.id,
    riderId: ride.riderId,
    driverId: ride.driverId,
    pickupAddress,
    pickupLat,
    pickupLng,
    destinationAddress,
    destinationLat,
    destinationLng,
    pickup: {
      address: pickupAddress,
      coordinates: { latitude: pickupLat, longitude: pickupLng },
    },
    destination: {
      address: destinationAddress,
      coordinates: { latitude: destinationLat, longitude: destinationLng },
    },
    fare: {
      estimated: totalFarePaise,
      final: ride.status === 'COMPLETED' ? totalFarePaise : null,
      breakdown,
    },
    distance: { estimated: distanceKm, actual: distanceKm },
    duration: { estimated: ride.durationMinutes || 15, actual: null },
    status: ride.status,
    paymentStatus: ride.paymentStatus,
    vehicleCategory: ride.vehicleCategory,
    vehicleType: ride.vehicleCategory,
    driver: formattedDriver,
    ratings: (ride as any).ratings || [],
    cancelledBy: ride.cancelledBy,
    cancellationReason: ride.cancellationReason,
    createdAt: ride.createdAt instanceof Date ? ride.createdAt.toISOString() : String(ride.createdAt),
    updatedAt: ride.updatedAt instanceof Date ? ride.updatedAt.toISOString() : String(ride.updatedAt),
  };
}

export async function toRideDtoWithDriver(ride: Ride): Promise<RideDto>;
export async function toRideDtoWithDriver(ride: null): Promise<null>;
export async function toRideDtoWithDriver(ride: Ride | null): Promise<RideDto | null>;
export async function toRideDtoWithDriver(ride: Ride | null): Promise<RideDto | null> {
  if (!ride) return null;
  let driverInfo: DriverProfile | null = null;
  if (ride.driverId) {
    try {
      driverInfo = await driverClient.getDriver(ride.driverId);
    } catch {
      driverInfo = null;
    }
  }
  return toRideDto(ride, driverInfo);
}
