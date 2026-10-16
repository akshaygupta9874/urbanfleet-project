import { isGeoapifyFeatureCollection, type GeoapifyFeature } from "../types/geoapify";

const API_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY;

export async function reverseGeocode(latitude: number, longitude: number) {
    if (!API_KEY) {
        throw new Error("Geoapify API key is missing.");
    }

    const response = await fetch(
        `https://api.geoapify.com/v1/geocode/reverse?lat=${latitude}&lon=${longitude}&apiKey=${API_KEY}`
    );

    if (!response.ok) {
        throw new Error("Geoapify reverse geocoding request failed.");
    }

    const data: unknown = await response.json();
    const feature = isGeoapifyFeatureCollection(data) ? data.features[0] : undefined;
    const formatted = feature?.properties?.formatted || feature?.properties?.name;

    if (!formatted) {
        throw new Error("Reverse geocoding response missing address.");
    }

    return formatted;
}

export async function searchPlaces(query: string): Promise<GeoapifyFeature[]> {
    if (!query.trim()) return [];

    const response = await fetch(
        `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(
            query
        )}&limit=5&apiKey=${API_KEY}`
    );

    const data: unknown = await response.json();

    return isGeoapifyFeatureCollection(data) ? data.features : [];
}