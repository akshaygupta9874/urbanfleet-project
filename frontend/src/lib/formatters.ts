/**
 * Canonical formatting utilities for UrbanFleet.
 * Ensures consistent display of currency (Paise -> Rupees),
 * distance (Kilometers/Meters), and duration (Minutes/Hours).
 */

/**
 * Format an integer paise amount into Indian Rupees string (e.g., "₹250.00", "-₹50.00").
 * @param paise integer paise value (e.g., 25000 paise = ₹250.00)
 */
export function formatFare(paise: number | null | undefined): string {
  if (paise == null || isNaN(paise)) return "₹0.00";
  const isNegative = paise < 0;
  const absRupees = Math.abs(paise) / 100;
  const formatted = absRupees.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return isNegative ? `-₹${formatted}` : `₹${formatted}`;
}

/**
 * Format an integer paise amount into Indian Rupees string without currency symbol (e.g., "250.00").
 */
export function formatFareWithoutSymbol(paise: number | null | undefined): string {
  if (paise == null || isNaN(paise)) return "0.00";
  const isNegative = paise < 0;
  const absRupees = Math.abs(paise) / 100;
  const formatted = absRupees.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Extract rupee value as a float number from a fare object or paise number.
 */
export function getFareRupees(
  fare: { estimated?: number | null; final?: number | null } | number | null | undefined
): number {
  if (fare == null) return 0;
  if (typeof fare === "number") {
    return isNaN(fare) ? 0 : fare / 100;
  }
  const paise = fare.final ?? fare.estimated ?? 0;
  return isNaN(paise) ? 0 : paise / 100;
}

/**
 * Extract distance in kilometers as a clean float.
 * Handles both number and RideDto distance object.
 * Note: Canonical distance unit is Kilometers.
 * Only if raw meters was accidentally supplied (> 10000 in single ride context) does it divide by 1000.
 */
export function getDistanceKm(
  dist: { estimated?: number | null; actual?: number | null } | number | null | undefined
): number {
  if (dist == null) return 0;
  let raw: number;
  if (typeof dist === "object") {
    raw = dist.actual ?? dist.estimated ?? 0;
  } else {
    raw = dist;
  }
  if (isNaN(raw) || raw < 0) return 0;
  // If dist is an object representing a single ride waypoint and raw > 10000 (e.g. 15000m -> 15km),
  // standard city trip distance is < 1000 km, so values > 10000 in a single ride object are legacy raw meters.
  if (typeof dist === "object" && raw > 10000) {
    return raw / 1000;
  }
  return raw;
}

/**
 * Format distance for UI display (e.g., "5.2 km", "120.5 km", or "800 m").
 * Sub-kilometer distances (< 1.0 km) are formatted in meters (e.g. "800 m", "150 m").
 * Kilometers and above (>= 1.0 km) are formatted in km (e.g. "1.0 km", "5.2 km").
 */
export function formatDistance(
  dist: { estimated?: number | null; actual?: number | null } | number | null | undefined
): string {
  const km = getDistanceKm(dist);
  if (km <= 0) return "0.0 km";
  if (km < 1.0) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(1)} km`;
}

/**
 * Extract duration in minutes as an integer.
 * Handles both number and RideDto duration object.
 * Canonical duration unit is Minutes.
 * If raw seconds (> 1000) was passed instead of minutes in an object, converts to minutes.
 */
export function getDurationMinutes(
  dur: { estimated?: number | null; actual?: number | null } | number | null | undefined
): number {
  if (dur == null) return 0;
  let raw: number;
  if (typeof dur === "object") {
    raw = dur.actual ?? dur.estimated ?? 0;
  } else {
    raw = dur;
  }
  if (isNaN(raw) || raw < 0) return 0;
  // If dur is an object representing a single ride and raw > 1000 (e.g. 1800s -> 30 min):
  // an urban ride duration is rarely > 1000 mins (> 16 hours), so values > 1000 in an object are legacy seconds.
  if (typeof dur === "object" && raw > 1000) {
    return Math.max(1, Math.round(raw / 60));
  }
  return Math.round(raw);
}

/**
 * Format duration for UI display:
 * - 0 or negative: "< 1 min"
 * - 1 to 59 minutes: "X min"
 * - 60 minutes: "1 hr"
 * - Multiples of 60: "X hrs"
 * - Combined: "Xh Ym"
 */
export function formatDuration(
  dur: { estimated?: number | null; actual?: number | null } | number | null | undefined
): string {
  const minutes = getDurationMinutes(dur);
  if (minutes <= 0) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) {
    return hours === 1 ? "1 hr" : `${hours} hrs`;
  }
  return `${hours}h ${remainingMins}m`;
}

/**
 * Calculate the great-circle distance between two geographic coordinates using Haversine formula in Kilometers.
 */
export function calculateHaversineDistanceKm(
  p1: { latitude?: number; longitude?: number } | { lat?: number; lng?: number } | null | undefined,
  p2: { latitude?: number; longitude?: number } | { lat?: number; lng?: number } | null | undefined
): number {
  if (!p1 || !p2 || typeof p1 !== "object" || typeof p2 !== "object") return 0;
  const lat1 = "latitude" in p1 ? p1.latitude : "lat" in p1 ? (p1 as { lat?: number }).lat : undefined;
  const lng1 = "longitude" in p1 ? p1.longitude : "lng" in p1 ? (p1 as { lng?: number }).lng : undefined;
  const lat2 = "latitude" in p2 ? p2.latitude : "lat" in p2 ? (p2 as { lat?: number }).lat : undefined;
  const lng2 = "longitude" in p2 ? p2.longitude : "lng" in p2 ? (p2 as { lng?: number }).lng : undefined;

  if (
    lat1 == null ||
    lng1 == null ||
    lat2 == null ||
    lng2 == null ||
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return 0;
  }

  const R = 6371; // Earth's mean radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
