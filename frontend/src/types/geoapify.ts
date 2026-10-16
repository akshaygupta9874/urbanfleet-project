export interface GeoapifyProperties {
  formatted?: string;
  name?: string;
  city?: string;
  town?: string;
  county?: string;
  country_code?: string;
  distance?: number;
  time?: number;
}

export type GeoapifyPointCoordinates = [number, number];
export type GeoapifyLineCoordinates = GeoapifyPointCoordinates[];
export type GeoapifyCoordinates = GeoapifyPointCoordinates | GeoapifyLineCoordinates[];

export interface GeoapifyFeature {
  type: "Feature";
  properties: GeoapifyProperties;
  geometry: {
    type: string;
    coordinates: GeoapifyCoordinates;
  };
}

export interface GeoapifyFeatureCollection {
  type: "FeatureCollection";
  features: GeoapifyFeature[];
}

export function isGeoapifyFeature(value: unknown): value is GeoapifyFeature {
  if (!value || typeof value !== "object") return false;

  const feature = value as Record<string, unknown>;
  const geometry = feature.geometry;
  const properties = feature.properties;

  return (
    feature.type === "Feature" &&
    !!properties &&
    typeof properties === "object" &&
    !!geometry &&
    typeof geometry === "object" &&
    Array.isArray((geometry as Record<string, unknown>).coordinates)
  );
}

export function isGeoapifyFeatureCollection(value: unknown): value is GeoapifyFeatureCollection {
  if (!value || typeof value !== "object") return false;

  const collection = value as Record<string, unknown>;
  return collection.type === "FeatureCollection" &&
    Array.isArray(collection.features) &&
    collection.features.every(isGeoapifyFeature);
}

export function getGeoapifyPoint(feature: GeoapifyFeature): GeoapifyPointCoordinates | null {
  const coordinates = feature.geometry.coordinates;
  return coordinates.length === 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number"
    ? coordinates as GeoapifyPointCoordinates
    : null;
}

export function getGeoapifyRouteLines(feature: GeoapifyFeature): GeoapifyLineCoordinates[] {
  const coordinates = feature.geometry.coordinates;
  if (coordinates.length === 0 || typeof coordinates[0] === "number") return [];
  return coordinates as GeoapifyLineCoordinates[];
}
