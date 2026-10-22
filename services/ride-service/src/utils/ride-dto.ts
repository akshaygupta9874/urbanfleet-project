import { Ride } from '../db/client.js';
import { FormattedDriver, IFareBreakdown, RideDto } from '@urbanfleet/common';

export function toRideDto(ride: Ride): RideDto;
export function toRideDto(ride: null): null;
export function toRideDto(ride: Ride | null): RideDto | null;
export function toRideDto(ride: Ride | null): RideDto | null {
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
  const formattedDriver: FormattedDriver | null = ride.driverId
    ? {
        id: ride.driverId,
        firstName: '',
        lastName: '',
        vehicleNumber: '',
        email: '',
        user: { firstName: '', lastName: '', email: '' },
        vehicle: { registrationNumber: '', model: '', color: '' },
      }
    : null;

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
    driver: formattedDriver,
    cancelledBy: ride.cancelledBy,
    cancellationReason: ride.cancellationReason,
    createdAt: ride.createdAt.toISOString(),
    updatedAt: ride.updatedAt.toISOString(),
  };
}
