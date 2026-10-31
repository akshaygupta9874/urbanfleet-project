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
 * Auto-corrects if raw routing meters (> 100) was passed instead of km.
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
  // If raw > 100, it's raw meters from Geoapify (e.g. 5200m -> 5.2km)
  if (raw > 100) {
    return raw / 1000;
  }
  return raw;
}

/**
 * Format distance for UI display (e.g., "5.2 km" or "150 m").
 */
export function formatDistance(
  dist: { estimated?: number | null; actual?: number | null } | number | null | undefined
): string {
  const km = getDistanceKm(dist);
  if (km <= 0) return "0.0 km";
  if (km < 0.2) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(1)} km`;
}

/**
 * Extract duration in minutes as an integer.
 * Handles both number and RideDto duration object.
 * Auto-corrects if raw seconds (> 300) was passed instead of minutes.
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
  // If raw > 300, it's raw seconds from Geoapify (e.g. 900s -> 15 min)
  if (raw > 300) {
    return Math.round(raw / 60);
  }
  return Math.round(raw);
}

/**
 * Format duration for UI display (e.g., "15 min", "1h 25m", "< 1 min").
 */
export function formatDuration(
  dur: { estimated?: number | null; actual?: number | null } | number | null | undefined
): string {
  const minutes = getDurationMinutes(dur);
  if (minutes <= 0) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) return `${hours} hr`;
  return `${hours}h ${remainingMins}m`;
}
