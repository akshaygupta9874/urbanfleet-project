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
  type?: "driver" | "pickup" | "destination" | "rider" | "default";
  popupHtml?: string;
}

interface MapViewProps {
  center: { lat: number; lng: number };
  zoom?: number;
  markers?: MapMarker[];
  path?: Array<{ lat: number; lng: number }>;
  className?: string;
  children?: ReactNode;
}

export default function MapView({
  center,
  zoom = 13,
  markers = [],
  path = [],
  className = "",
  children,
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const polylineLayerRef = useRef<L.Polyline | null>(null);
  const initialCenterRef = useRef(center);
  const initialZoomRef = useRef(zoom);
  const hasInitiallyFittedRef = useRef(false);

  const geoapifyApiKey = import.meta.env.VITE_GEOAPIFY_API_KEY ?? "";

  // Dynamically inject Leaflet CSS & custom animation styles to prevent bundle errors
  useEffect(() => {
    const linkId = "leaflet-css";
    if (!document.getElementById(linkId)) {
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    const styleId = "urbanfleet-map-styles";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        @keyframes uf-driver-radar {
          0% { transform: scale(0.6); opacity: 0.85; }
          65% { transform: scale(2.1); opacity: 0.15; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        @keyframes uf-driver-beacon {
          0%, 100% { box-shadow: 0 0 0 0 rgba(14, 165, 233, 0.7), 0 4px 14px rgba(14, 165, 233, 0.4); }
          50% { box-shadow: 0 0 0 6px rgba(14, 165, 233, 0), 0 6px 20px rgba(14, 165, 233, 0.6); }
        }
        .custom-map-marker {
          background: transparent !important;
          border: none !important;
        }
        .uf-leaflet-popup .leaflet-popup-content-wrapper {
          background: #fffdf9 !important;
          color: #2e1808 !important;
          border-radius: 16px !important;
          border: 1px solid rgba(197, 138, 58, 0.35) !important;
          box-shadow: 0 12px 30px -4px rgba(46, 24, 8, 0.25) !important;
          padding: 4px !important;
        }
        .uf-leaflet-popup .leaflet-popup-tip {
          background: #fffdf9 !important;
        }
      `;
      document.head.appendChild(style);
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

  // Update center and zoom dynamically when center changes
  useEffect(() => {
    if (mapInstanceRef.current && center?.lat && center?.lng) {
      mapInstanceRef.current.setView([center.lat, center.lng], zoom);
    }
  }, [center.lat, center.lng, zoom]);

  // Update custom styled theme markers with dedicated telemetry & pin styles
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current) return;

    markersLayerRef.current.clearLayers();

    markers.forEach((marker) => {
      if (!marker?.position || isNaN(marker.position.lat) || isNaN(marker.position.lng)) {
        return;
      }

      const type =
        marker.type ||
        (marker.label === "🚗" || marker.label === "DR"
          ? "driver"
          : marker.label === "P"
          ? "pickup"
          : marker.label === "D"
          ? "destination"
          : marker.label === "R"
          ? "rider"
          : "default");

      let iconHtml: string;
      let iconSize: [number, number];
      let iconAnchor: [number, number];
      let zIndexOffset = 500;

      if (type === "driver") {
        iconSize = [52, 52];
        iconAnchor = [26, 26];
        zIndexOffset = 2500;
        const driverName = marker.title || "Captain";
        iconHtml = `
          <div style="position: relative; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
            <div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: rgba(14, 165, 233, 0.28); animation: uf-driver-radar 2.4s infinite cubic-bezier(0.215, 0.61, 0.355, 1);"></div>
            <div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: rgba(56, 189, 248, 0.38); animation: uf-driver-radar 2.4s infinite cubic-bezier(0.215, 0.61, 0.355, 1) 0.8s;"></div>
            <div style="position: relative; width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg, #090d16 0%, #1e293b 100%); border: 2.5px solid #38bdf8; display: flex; align-items: center; justify-content: center; animation: uf-driver-beacon 2.4s infinite; color: #38bdf8; z-index: 2; box-shadow: 0 4px 14px rgba(14,165,233,0.45);">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/>
                <circle cx="7" cy="17" r="2" fill="#38bdf8"/>
                <path d="M9 17h6"/>
                <circle cx="17" cy="17" r="2" fill="#38bdf8"/>
              </svg>
            </div>
            <div style="position: absolute; bottom: -8px; background: #090d16; color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.7); font-size: 8.5px; font-weight: 800; padding: 1px 6px; border-radius: 999px; letter-spacing: 0.5px; text-transform: uppercase; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.5); z-index: 3; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
              ${driverName}
            </div>
          </div>
        `;
      } else if (type === "pickup") {
        iconSize = [36, 44];
        iconAnchor = [18, 42];
        zIndexOffset = 1000;
        iconHtml = `
          <div style="position: relative; width: 36px; height: 44px; display: flex; align-items: flex-start; justify-content: center; cursor: pointer;">
            <div style="width: 32px; height: 32px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); background: linear-gradient(135deg, #10b981 0%, #047857 100%); border: 2.5px solid #ffffff; box-shadow: 0 4px 12px rgba(4, 120, 87, 0.45); display: flex; align-items: center; justify-content: center;">
              <span style="transform: rotate(45deg); color: #ffffff; font-weight: 900; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">P</span>
            </div>
          </div>
        `;
      } else if (type === "destination") {
        iconSize = [36, 44];
        iconAnchor = [18, 42];
        zIndexOffset = 1000;
        iconHtml = `
          <div style="position: relative; width: 36px; height: 44px; display: flex; align-items: flex-start; justify-content: center; cursor: pointer;">
            <div style="width: 32px; height: 32px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); background: linear-gradient(135deg, #f43f5e 0%, #be123c 100%); border: 2.5px solid #ffffff; box-shadow: 0 4px 12px rgba(190, 18, 60, 0.45); display: flex; align-items: center; justify-content: center;">
              <span style="transform: rotate(45deg); color: #ffffff; font-weight: 900; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">D</span>
            </div>
          </div>
        `;
      } else if (type === "rider") {
        iconSize = [36, 36];
        iconAnchor = [18, 18];
        zIndexOffset = 1200;
        iconHtml = `
          <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
            <div style="width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); border: 2px solid #ffffff; box-shadow: 0 4px 10px rgba(109, 40, 217, 0.4); display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 900; font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
              R
            </div>
          </div>
        `;
      } else {
        iconSize = [30, 30];
        iconAnchor = [15, 15];
        iconHtml = `<div style="background-color: #5D4037; color: #FAF6F0; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px; border: 2px solid #FAF6F0; box-shadow: 0 4px 8px rgba(62,39,35,0.3); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${marker.label}</div>`;
      }

      const customIcon = L.divIcon({
        className: "custom-map-marker",
        html: iconHtml,
        iconSize,
        iconAnchor,
      });

      const m = L.marker([marker.position.lat, marker.position.lng], {
        icon: customIcon,
        title: marker.title,
        zIndexOffset,
      });

      if (marker.popupHtml) {
        m.bindPopup(marker.popupHtml, { className: "uf-leaflet-popup" });
      } else if (marker.title) {
        const popupContent =
          type === "driver"
            ? `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2px 4px;">
                 <div style="font-weight: 700; font-size: 13px; color: #0f172a; display: flex; align-items: center; gap: 6px;">
                   <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#0284c7; box-shadow: 0 0 6px #0284c7;"></span>
                   ${marker.title}
                 </div>
                 <div style="font-size: 11px; font-weight: 600; color: #0284c7; margin-top: 4px;">Live Captain Telemetry Active</div>
               </div>`
            : type === "pickup"
            ? `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2px 4px;">
                 <div style="font-weight: 700; font-size: 13px; color: #065f46;">Pickup Location</div>
                 <div style="font-size: 11px; color: #4b5563; margin-top: 2px;">${marker.title}</div>
               </div>`
            : type === "destination"
            ? `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2px 4px;">
                 <div style="font-weight: 700; font-size: 13px; color: #9f1239;">Destination</div>
                 <div style="font-size: 11px; color: #4b5563; margin-top: 2px;">${marker.title}</div>
               </div>`
            : `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2px 4px; font-weight: 600; font-size: 12px; color: #3e2723;">${marker.title}</div>`;

        m.bindPopup(popupContent, { className: "uf-leaflet-popup" });
      }

      markersLayerRef.current?.addLayer(m);
    });

    // Auto-fit bounds on initial load if multiple markers exist
    if (!hasInitiallyFittedRef.current && markers.length >= 2 && mapInstanceRef.current) {
      const validPoints = markers.filter(
        (m) =>
          typeof m.position?.lat === "number" &&
          typeof m.position?.lng === "number" &&
          !isNaN(m.position.lat) &&
          !isNaN(m.position.lng)
      );
      if (validPoints.length >= 2) {
        const bounds = L.latLngBounds(validPoints.map((m) => [m.position.lat, m.position.lng]));
        mapInstanceRef.current.fitBounds(bounds, { padding: [55, 55], maxZoom: 16 });
        hasInitiallyFittedRef.current = true;
      }
    }
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

  // Interactive quick focus actions
  const driverMarker = markers.find(
    (m) =>
      m.type === "driver" ||
      m.label === "🚗" ||
      m.label === "DR" ||
      m.title?.toLowerCase().includes("captain") ||
      m.title?.toLowerCase().includes("driver")
  );

  const handleFocusCaptain = () => {
    if (mapInstanceRef.current && driverMarker) {
      mapInstanceRef.current.flyTo(
        [driverMarker.position.lat, driverMarker.position.lng],
        16,
        { duration: 1 }
      );
    }
  };

  const handleFitRoute = () => {
    if (mapInstanceRef.current && markers.length >= 2) {
      const validPoints = markers.filter(
        (m) => typeof m.position?.lat === "number" && typeof m.position?.lng === "number"
      );
      if (validPoints.length >= 2) {
        const bounds = L.latLngBounds(validPoints.map((m) => [m.position.lat, m.position.lng]));
        mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      }
    }
  };

  if (!geoapifyApiKey) {
    return (
      <div
        className={`grid min-h-[320px] place-items-center rounded-3xl border border-[#D7CCC8] bg-[#FAF6F0] p-6 text-center text-sm text-[#5D4037] ${className}`}
      >
        <div>
          <p className="font-semibold text-[#3E2723]">Geoapify API key is missing.</p>
          <p>
            Set <code>VITE_GEOAPIFY_API_KEY</code> in your frontend environment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-3xl border border-[#D7CCC8] bg-[#FAF6F0] ${className} relative z-10`}
    >
      <div ref={mapRef} style={{ width: "100%", height: "100%", minHeight: "640px" }} />

      {/* Floating Interactive Quick-Action Controls */}
      <div className="absolute top-3.5 right-3.5 z-20 flex flex-col gap-2 pointer-events-auto">
        {driverMarker && (
          <button
            type="button"
            onClick={handleFocusCaptain}
            className="flex items-center gap-1.5 rounded-xl border border-sky-400/60 bg-slate-900/90 px-3 py-1.5 text-xs font-bold text-sky-300 shadow-xl backdrop-blur-md transition-all hover:bg-slate-900 hover:scale-105 active:scale-95 cursor-pointer"
            title="Recenter on Captain"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-400"></span>
            </span>
            Focus Captain
          </button>
        )}
        {markers.length > 1 && (
          <button
            type="button"
            onClick={handleFitRoute}
            className="flex items-center gap-1.5 rounded-xl border border-[#c58a3a]/40 bg-[#fffdf9]/95 px-3 py-1.5 text-xs font-bold text-[#3a1f0a] shadow-xl backdrop-blur-md transition-all hover:bg-[#fffdf9] hover:scale-105 active:scale-95 cursor-pointer"
            title="View Full Route"
          >
            Fit Route
          </button>
        )}
      </div>

      {children}
    </div>
  );
}
