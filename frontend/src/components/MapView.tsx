import { useEffect, useRef, type ReactNode } from "react";
import L from "leaflet";

export interface MapMarker {
  position: {
    lat: number;
    lng: number;
  };
  label: string;
  title?: string;
  icon?: string;
}

interface MapViewProps {
  center: { lat: number; lng: number };
  zoom?: number;
  markers?: MapMarker[];
  path?: Array<{ lat: number; lng: number }>;
  className?: string;
  children?: ReactNode;
}

export default function MapView({ center, zoom = 13, markers = [], path = [], className = "" }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const polylineLayerRef = useRef<L.Polyline | null>(null);
  const initialCenterRef = useRef(center);
  const initialZoomRef = useRef(zoom);

  const geoapifyApiKey = import.meta.env.VITE_GEOAPIFY_API_KEY ?? "";

  // Dynamically inject Leaflet CSS to prevent Vite import bundle errors
  useEffect(() => {
    const linkId = "leaflet-css";
    if (!document.getElementById(linkId)) {
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: false,
      }).setView([initialCenterRef.current.lat, initialCenterRef.current.lng], initialZoomRef.current);

      // Geoapify Raster Tile API integration
      const tileUrl = geoapifyApiKey
        ? `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${geoapifyApiKey}`
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

      L.tileLayer(tileUrl, {
        maxZoom: 20,
        subdomains: ["a", "b", "c", "d"],
      }).addTo(map);

      markersLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [geoapifyApiKey]);

  // Update center and zoom dynamically
  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([center.lat, center.lng], zoom);
    }
  }, [center.lat, center.lng, zoom]);

  // Update custom styled theme markers
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current) return;

    markersLayerRef.current.clearLayers();

    markers.forEach((marker) => {
      const customIcon = L.divIcon({
        className: "custom-map-marker",
        html: `<div style="background-color: #5D4037; color: #FAF6F0; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px; border: 2px solid #FAF6F0; box-shadow: 0 4px 8px rgba(62,39,35,0.3);">${marker.label}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });

      const m = L.marker([marker.position.lat, marker.position.lng], {
        icon: customIcon,
        title: marker.title,
      });

      if (markersLayerRef.current) {
        markersLayerRef.current.addLayer(m);
      }
    });
  }, [markers]);

  // Update polyline route path
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (polylineLayerRef.current) {
      polylineLayerRef.current.remove();
      polylineLayerRef.current = null;
    }

    if (path && path.length > 1) {
      const latLngs = path.map((pt) => [pt.lat, pt.lng] as [number, number]);
      polylineLayerRef.current = L.polyline(latLngs, {
        color: "#5D4037",
        weight: 5,
        opacity: 0.85,
      }).addTo(mapInstanceRef.current);
    }
  }, [path]);

  if (!geoapifyApiKey) {
    return (
      <div className={`grid min-h-[320px] place-items-center rounded-3xl border border-[#D7CCC8] bg-[#FAF6F0] p-6 text-center text-sm text-[#5D4037] ${className}`}>
        <div>
          <p className="font-semibold text-[#3E2723]">Geoapify API key is missing.</p>
          <p>Set <code>GEOAPIFY_API_KEY</code> in your frontend environment.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-3xl border border-[#D7CCC8] bg-[#FAF6F0] ${className} relative z-10`}>
      <div ref={mapRef} style={{ width: "100%", height: "100%", minHeight: "640px" }} />
    </div>
  );
}