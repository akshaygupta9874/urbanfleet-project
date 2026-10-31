import { useMemo, useState, useEffect, useRef } from "react";

type Point = { x: number; y: number };

type RideConfig = {
  id: string;
  points: Point[];
  duration: number;
  startDelay: number;
  pickupIndex: number;
  destinationIndex: number;
};

type ComputedRide = RideConfig & {
  path: string;
  corridorPath: string;
  pickup: Point;
  destination: Point;
  keyPoints: string;
  keyTimes: string;
};

const CORNER_RADIUS = 16;

/**
 * Builds an SVG path with smooth circular arcs (A) at 90-degree street intersections
 * and computes exact analytical arc-length fractions so cars never snap rotation
 * or drift off pickup/drop-off pins.
 */
function buildRoundedPath(points: Point[], radius: number): {
  d: string;
  vertexDistances: number[];
  totalLength: number;
} {
  if (points.length === 0) {
    return { d: "", vertexDistances: [], totalLength: 0 };
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  let currentPos = points[0];
  let cumDist = 0;
  const vertexDistances: number[] = [0];

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const dxIn = curr.x - prev.x;
    const dyIn = curr.y - prev.y;
    const lenIn = Math.hypot(dxIn, dyIn);

    if (lenIn === 0) {
      vertexDistances.push(cumDist);
      continue;
    }

    const uxIn = dxIn / lenIn;
    const uyIn = dyIn / lenIn;

    let isTurn = false;
    let uxOut = 0;
    let uyOut = 0;
    let cross = 0;
    let turnRadius = radius;

    if (i < points.length - 1) {
      const next = points[i + 1];
      const dxOut = next.x - curr.x;
      const dyOut = next.y - curr.y;
      const lenOut = Math.hypot(dxOut, dyOut);

      if (lenOut > 0) {
        uxOut = dxOut / lenOut;
        uyOut = dyOut / lenOut;
        cross = uxIn * uyOut - uyIn * uxOut;
        if (Math.abs(cross) > 0.5) {
          isTurn = true;
          turnRadius = Math.min(radius, lenIn * 0.4, lenOut * 0.4);
        }
      }
    }

    if (isTurn) {
      const entryX = curr.x - uxIn * turnRadius;
      const entryY = curr.y - uyIn * turnRadius;
      const exitX = curr.x + uxOut * turnRadius;
      const exitY = curr.y + uyOut * turnRadius;

      const straightLen = Math.hypot(entryX - currentPos.x, entryY - currentPos.y);
      d += ` L ${entryX.toFixed(1)} ${entryY.toFixed(1)}`;
      cumDist += straightLen;

      const arcLen = (Math.PI * turnRadius) / 2;
      vertexDistances.push(cumDist + arcLen * 0.5);

      const sweepFlag = cross > 0 ? 1 : 0;
      d += ` A ${turnRadius} ${turnRadius} 0 0 ${sweepFlag} ${exitX.toFixed(1)} ${exitY.toFixed(1)}`;
      cumDist += arcLen;
      currentPos = { x: exitX, y: exitY };
    } else {
      const straightLen = Math.hypot(curr.x - currentPos.x, curr.y - currentPos.y);
      d += ` L ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
      cumDist += straightLen;
      vertexDistances.push(cumDist);
      currentPos = curr;
    }
  }

  return { d, vertexDistances, totalLength: cumDist };
}

function calculateRide(ride: RideConfig): ComputedRide {
  const duration = Number((ride.duration / 1.35).toFixed(2));
  const { d: fullPath, vertexDistances, totalLength } = buildRoundedPath(
    ride.points,
    CORNER_RADIUS
  );

  const corridorPoints = ride.points.slice(ride.pickupIndex, ride.destinationIndex + 1);
  const { d: corridorPath } = buildRoundedPath(corridorPoints, CORNER_RADIUS);

  const pickupDistance = vertexDistances[ride.pickupIndex];
  const destinationDistance = vertexDistances[ride.destinationIndex];

  const pickupFraction = Number((pickupDistance / totalLength).toFixed(4));
  const destinationFraction = Number((destinationDistance / totalLength).toFixed(4));

  const pickupPause = 1.6;
  const destinationPause = 1.2;
  const driveTime = Math.max(1, duration - pickupPause - destinationPause);
  const speed = totalLength / driveTime;

  const pickupArrival = pickupDistance / speed;
  const pickupEnd = pickupArrival + pickupPause;
  const destinationArrival = pickupEnd + (destinationDistance - pickupDistance) / speed;
  const destinationEnd = destinationArrival + destinationPause;

  const t1 = Number((pickupArrival / duration).toFixed(4));
  const t2 = Number((pickupEnd / duration).toFixed(4));
  const t3 = Number((destinationArrival / duration).toFixed(4));
  const t4 = Number((destinationEnd / duration).toFixed(4));

  return {
    ...ride,
    duration,
    path: fullPath,
    corridorPath,
    pickup: ride.points[ride.pickupIndex],
    destination: ride.points[ride.destinationIndex],
    keyPoints: `0;${pickupFraction};${pickupFraction};${destinationFraction};${destinationFraction};1`,
    keyTimes: `0;${t1};${t2};${t3};${t4};1`,
  };
}

const VERTICALS = [70, 160, 260, 340, 430, 540, 620, 720, 820, 900, 1000, 1120];
const HORIZONTALS = [70, 150, 260, 330, 430, 500, 610, 700];
const BLOCK_TONES = ["#e8c98b", "#dbb271", "#efd8a3", "#cf9d55"];

/**
 * All 7 routes enter from off-screen, stop at collinear curb coordinates for
 * pickup & drop-off, navigate rounded 90-degree intersections, and exit off-screen.
 */
const RAW_RIDES: RideConfig[] = [
  {
    id: "r1",
    points: [
      { x: -60, y: 70 },
      { x: 160, y: 70 }, // Pickup (curb)
      { x: 430, y: 70 }, // Turn S
      { x: 430, y: 260 }, // Turn E
      { x: 720, y: 260 }, // Destination (curb)
      { x: 900, y: 260 }, // Turn N
      { x: 900, y: -60 },
    ],
    pickupIndex: 1,
    destinationIndex: 4,
    duration: 24,
    startDelay: 0,
  },
  {
    id: "r2",
    points: [
      { x: 1260, y: 150 },
      { x: 1000, y: 150 }, // Pickup (curb)
      { x: 720, y: 150 }, // Turn S
      { x: 720, y: 330 }, // Turn W
      { x: 430, y: 330 }, // Destination (curb)
      { x: 260, y: 330 }, // Turn S
      { x: 260, y: 880 },
    ],
    pickupIndex: 1,
    destinationIndex: 4,
    duration: 26,
    startDelay: 2.5,
  },
  {
    id: "r3",
    points: [
      { x: 70, y: -60 },
      { x: 70, y: 150 }, // Pickup (curb)
      { x: 70, y: 430 }, // Turn E
      { x: 340, y: 430 }, // Turn S
      { x: 340, y: 610 }, // Destination (curb)
      { x: 340, y: 880 },
    ],
    pickupIndex: 1,
    destinationIndex: 4,
    duration: 23,
    startDelay: 5.5,
  },
  {
    id: "r4",
    points: [
      { x: 1000, y: -60 },
      { x: 1000, y: 260 }, // Pickup (curb)
      { x: 1000, y: 500 }, // Turn W
      { x: 820, y: 500 }, // Turn S
      { x: 820, y: 610 }, // Destination (curb)
      { x: 820, y: 880 },
    ],
    pickupIndex: 1,
    destinationIndex: 4,
    duration: 25,
    startDelay: 8,
  },
  {
    id: "r5",
    points: [
      { x: -60, y: 610 },
      { x: 160, y: 610 }, // Pickup (curb)
      { x: 540, y: 610 }, // Turn N
      { x: 540, y: 500 }, // Turn E
      { x: 720, y: 500 }, // Destination (curb)
      { x: 1260, y: 500 },
    ],
    pickupIndex: 1,
    destinationIndex: 4,
    duration: 27,
    startDelay: 11,
  },
  {
    id: "r6",
    points: [
      { x: 1260, y: 700 },
      { x: 1000, y: 700 }, // Pickup (curb)
      { x: 620, y: 700 }, // Turn N
      { x: 620, y: 610 }, // Turn W
      { x: 260, y: 610 }, // Destination (curb)
      { x: -60, y: 610 },
    ],
    pickupIndex: 1,
    destinationIndex: 4,
    duration: 26,
    startDelay: 14,
  },
  {
    id: "r7",
    points: [
      { x: 540, y: 880 },
      { x: 540, y: 700 }, // Pickup (curb)
      { x: 540, y: 430 }, // Turn E
      { x: 820, y: 430 }, // Turn N
      { x: 820, y: 260 }, // Destination (curb)
      { x: 820, y: -60 },
    ],
    pickupIndex: 1,
    destinationIndex: 4,
    duration: 25,
    startDelay: 17,
  },
];

export function CityMapBackground() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile, { passive: true });
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Freeze both CSS animations and SVG SMIL <animateMotion> when off-screen or tab is hidden
  useEffect(() => {
    if (!containerRef.current || typeof IntersectionObserver === "undefined") return;

    let inViewport = true;

    const syncPlayState = () => {
      const shouldRun = inViewport && !document.hidden;
      setIsActive(shouldRun);
      if (svgRef.current) {
        if (shouldRun) {
          svgRef.current.unpauseAnimations?.();
        } else {
          svgRef.current.pauseAnimations?.();
        }
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        inViewport = entry.isIntersecting;
        syncPlayState();
      },
      { threshold: 0.02 }
    );

    observer.observe(containerRef.current);
    document.addEventListener("visibilitychange", syncPlayState);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncPlayState);
    };
  }, []);

  const rides = useMemo(() => RAW_RIDES.map(calculateRide), []);

  // 4 balanced routes on mobile for locked 60fps; all 7 on desktop
  const activeRides = useMemo(
    () => (isMobile ? [rides[0], rides[2], rides[4], rides[5]] : rides),
    [isMobile, rides]
  );

  // Memoize static city canvas so re-renders never recalculate static SVG nodes
  const staticCityLayer = useMemo(() => {
    return (
      <g className="city-static-layer">
        {/* City Blocks & Subtle Architectural Footprints */}
        {VERTICALS.slice(0, -1).map((vertical, column) =>
          HORIZONTALS.slice(0, -1).map((horizontal, row) => {
            const width = VERTICALS[column + 1] - vertical - 14;
            const height = HORIZONTALS[row + 1] - horizontal - 14;
            const tone = BLOCK_TONES[(column + row) % BLOCK_TONES.length];
            const isPlazaAdjacent = column === 5 && row === 3;
            const hasInnerCourt = (column + row) % 3 === 0 && width > 65 && height > 65;

            return (
              <g key={`block-${column}-${row}`}>
                {/* Block Shadow / Curb */}
                <rect
                  x={vertical + 7}
                  y={horizontal + 8}
                  width={width}
                  height={height}
                  rx={6}
                  fill="#7a4416"
                  opacity={0.14}
                />
                {/* Main Block Parcel */}
                <rect
                  x={vertical + 7}
                  y={horizontal + 7}
                  width={width}
                  height={height}
                  rx={6}
                  fill={tone}
                  opacity={0.62}
                />
                {/* Inner Building Courtyard Footprint */}
                {hasInnerCourt && !isPlazaAdjacent && (
                  <rect
                    x={vertical + 16}
                    y={horizontal + 16}
                    width={width - 18}
                    height={height - 18}
                    rx={3}
                    fill="#fff4dc"
                    opacity={0.22}
                    stroke="#7a4416"
                    strokeWidth={0.6}
                    strokeOpacity={0.2}
                  />
                )}
              </g>
            );
          })
        )}

        {/* River Bank Outer Glow & Water Channel */}
        <path
          d="M -60 700 C 150 648, 350 762, 620 690 S 1050 558, 1260 620 L 1260 840 L -60 840 Z"
          fill="#fff4dc"
          opacity={0.45}
        />
        <path
          d="M -60 706 C 150 654, 350 768, 620 696 S 1050 564, 1260 626 L 1260 840 L -60 840 Z"
          fill="url(#ufRiverGradient)"
          opacity={0.42}
        />
        <path
          d="M -60 732 C 160 682, 360 788, 630 720 S 1050 592, 1260 650"
          fill="none"
          stroke="#fff4dc"
          strokeWidth={1.2}
          strokeDasharray="12 18"
          opacity={0.35}
        />

        {/* Street Casings (Curbs) */}
        {VERTICALS.map((v) => (
          <line
            key={`casing-v-${v}`}
            x1={v}
            y1={-30}
            x2={v}
            y2={860}
            stroke="#b88444"
            strokeWidth={11}
            opacity={0.35}
          />
        ))}
        {HORIZONTALS.map((h) => (
          <line
            key={`casing-h-${h}`}
            x1={-30}
            y1={h}
            x2={1230}
            y2={h}
            stroke="#b88444"
            strokeWidth={11}
            opacity={0.35}
          />
        ))}

        {/* Primary Street Surfaces */}
        {VERTICALS.map((v) => (
          <line
            key={`street-v-${v}`}
            x1={v}
            y1={-30}
            x2={v}
            y2={860}
            stroke="#fff6e3"
            strokeWidth={8.5}
          />
        ))}
        {HORIZONTALS.map((h) => (
          <line
            key={`street-h-${h}`}
            x1={-30}
            y1={h}
            x2={1230}
            y2={h}
            stroke="#fff6e3"
            strokeWidth={8.5}
          />
        ))}

        {/* Dashed Lane Dividers */}
        {VERTICALS.map((v) => (
          <line
            key={`mark-v-${v}`}
            x1={v}
            y1={-30}
            x2={v}
            y2={860}
            stroke="#7a4416"
            strokeWidth={1}
            strokeDasharray="5 9"
            opacity={0.42}
          />
        ))}
        {HORIZONTALS.map((h) => (
          <line
            key={`mark-h-${h}`}
            x1={-30}
            y1={h}
            x2={1230}
            y2={h}
            stroke="#7a4416"
            strokeWidth={1}
            strokeDasharray="5 9"
            opacity={0.42}
          />
        ))}

        {/* Grand Central Transit Roundabout */}
        <g transform="translate(620 430)">
          <circle r={48} fill="#b88444" opacity={0.28} />
          <circle r={44} fill="none" stroke="#fff6e3" strokeWidth={11} />
          <circle
            r={44}
            fill="none"
            stroke="#7a4416"
            strokeWidth={1}
            strokeDasharray="5 7"
            opacity={0.45}
          />
          <circle r={28} fill="#e8c98b" stroke="#7a4416" strokeWidth={1} opacity={0.85} />
          <circle r={28} fill="url(#cityHatch)" opacity={0.22} />
          <circle r={6} fill="#3a1f0a" opacity={0.65} />
        </g>
      </g>
    );
  }, []);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
      aria-hidden="true"
    >
      <style>{`
        @keyframes uf-pulse-ring {
          0% { transform: scale(0.75); opacity: 0.85; }
          75% { transform: scale(1.55); opacity: 0; }
          100% { transform: scale(1.55); opacity: 0; }
        }
        @keyframes uf-map-drift {
          0%, 100% { transform: scale(1.02) translate3d(0px, 0px, 0px); }
          50% { transform: scale(1.035) translate3d(-8px, -5px, 0px); }
        }
        .uf-marker-ring {
          transform-box: fill-box;
          transform-origin: center;
          animation: uf-pulse-ring 2.8s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }
        .uf-map-motion {
          animation: uf-map-drift 28s ease-in-out infinite;
          will-change: transform;
        }
      `}</style>

      {/* Base Warm Cartographic Parchment Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_15%,#fff8eb_0%,#f5e6c8_38%,#e6c893_70%,#c99a5a_100%)]" />

      {/* Subtle Paper Grain Texture */}
      <div
        className="absolute inset-0 opacity-[0.16] mix-blend-multiply"
        style={{
          backgroundImage:
            "radial-gradient(rgba(80,45,15,0.35) 1px, transparent 1px), radial-gradient(rgba(80,45,15,0.18) 1px, transparent 1px)",
          backgroundSize: "3px 3px, 7px 7px",
          backgroundPosition: "0 0, 1px 2px",
        }}
      />

      {/* Zero-Shader-Cost Ambient Lighting (Fast on both Mobile & Desktop) */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_8%_10%,rgba(217,165,33,0.28)_0%,transparent_50%),radial-gradient(circle_at_92%_90%,rgba(122,68,22,0.32)_0%,transparent_50%)]" />

      {/* Vector City & Autonomous Fleet Layer */}
      <svg
        ref={svgRef}
        viewBox="0 0 1200 820"
        preserveAspectRatio="xMidYMid slice"
        className={`absolute inset-0 h-full w-full transform-gpu ${
          isMobile ? "" : "uf-map-motion"
        }`}
        style={{ animationPlayState: isActive ? "running" : "paused" }}
      >
        <defs>
          <radialGradient id="cityMarkerGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F2CD7C" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#F2CD7C" stopOpacity="0" />
          </radialGradient>

          <linearGradient id="ufRiverGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#b5742c" />
            <stop offset="50%" stopColor="#965819" />
            <stop offset="100%" stopColor="#6b3a12" />
          </linearGradient>

          <linearGradient id="ufHeadlightBeam" x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="#fff4dc" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#fff4dc" stopOpacity="0" />
          </linearGradient>

          <pattern
            id="cityHatch"
            width={6}
            height={6}
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke="#7a4416" strokeWidth="1" />
          </pattern>

          {/* Reusable Instanced Top-Down Luxury Cab Glyph */}
          <g id="uf-car-glyph">
            {/* Headlight Cone */}
            <path
              d="M 10 -3.5 L 26 -9 L 26 9 L 10 3.5 Z"
              fill="url(#ufHeadlightBeam)"
            />
            {/* Drop Shadow */}
            <ellipse cx={0} cy={1} rx={12.5} ry={4.6} fill="#1c0f05" opacity={0.22} />
            {/* Wheels */}
            <rect x={-8} y={-6.4} width={3.4} height={1.6} rx={0.8} fill="#1c0f05" opacity={0.65} />
            <rect x={-8} y={4.8} width={3.4} height={1.6} rx={0.8} fill="#1c0f05" opacity={0.65} />
            <rect x={4.8} y={-6.4} width={3.4} height={1.6} rx={0.8} fill="#1c0f05" opacity={0.65} />
            <rect x={4.8} y={4.8} width={3.4} height={1.6} rx={0.8} fill="#1c0f05" opacity={0.65} />
            {/* Chassis */}
            <rect
              x={-11}
              y={-5.5}
              width={22}
              height={11}
              rx={4.2}
              fill="#D9A521"
              stroke="#1c0f05"
              strokeWidth={1.1}
            />
            {/* Windshield & Panoramic Roof */}
            <rect x={-4.5} y={-4} width={11.5} height={8} rx={2.2} fill="#2e1808" opacity={0.8} />
            <rect x={-3} y={-3.2} width={5.5} height={6.4} rx={1.4} fill="#5c3211" />
            {/* Front LED Headlights */}
            <circle cx={10.4} cy={-3.1} r={1.1} fill="#fffdf9" />
            <circle cx={10.4} cy={3.1} r={1.1} fill="#fffdf9" />
            {/* Rear Brake Taillights */}
            <rect x={-11} y={-4} width={1.2} height={2.2} rx={0.5} fill="#e11d48" />
            <rect x={-11} y={1.8} width={1.2} height={2.2} rx={0.5} fill="#e11d48" />
          </g>

          {/* Reusable Instanced Rider Pickup Pin Glyph */}
          <g id="uf-rider-glyph">
            <ellipse cx={0} cy={1} rx={4.5} ry={1.8} fill="#1c0f05" opacity={0.25} />
            <path
              d="M0,0 C-8,-10 -9.5,-16 -9.5,-19.5 C-9.5,-25 -5.2,-29 0,-29 C5.2,-29 9.5,-25 9.5,-19.5 C9.5,-16 8,-10 0,0 Z"
              fill="#D9A521"
              stroke="#1c0f05"
              strokeWidth={1.1}
            />
            <circle cx={0} cy={-21} r={2.3} fill="#1c0f05" />
            <path
              d="M-3.4,-16.3 C-3.4,-19 3.4,-19 3.4,-16.3 L3.4,-13.8 C3.4,-12.6 -3.4,-12.6 -3.4,-13.8 Z"
              fill="#1c0f05"
            />
            <path
              d="M-6.2,-25 C-4.6,-27.3 -1.6,-28.8 1.4,-28.8"
              stroke="#fff4dc"
              strokeWidth={1}
              fill="none"
              opacity={0.7}
              strokeLinecap="round"
            />
          </g>

          {/* Reusable Instanced Destination Beacon Glyph */}
          <g id="uf-dest-glyph">
            <circle cx={0} cy={0} r={7} fill="#3a1f0a" stroke="#ffd88a" strokeWidth={1.5} />
            <circle cx={0} cy={0} r={2.8} fill="#ffd88a" />
          </g>
        </defs>

        {/* Static City Streets, Blocks & River */}
        {staticCityLayer}

        {/* Active Dispatch Corridors, Pickup Pins, Drop-off Beacons & Moving Fleet */}
        {activeRides.map((ride, index) => (
          <g key={ride.id}>
            {/* Highlighted GPS Dispatch Route Corridor (Pickup -> Destination) */}
            <path
              d={ride.corridorPath}
              fill="none"
              stroke="#c58a3a"
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.28}
            />
            <path
              d={ride.corridorPath}
              fill="none"
              stroke="#3a1f0a"
              strokeWidth={1.6}
              strokeDasharray="4 6"
              strokeLinecap="round"
              opacity={0.45}
            />

            {/* Pickup Marker & Pulsing Radar Ring */}
            <g transform={`translate(${ride.pickup.x} ${ride.pickup.y})`}>
              <circle cx={0} cy={-14} r={19} fill="url(#cityMarkerGlow)" />
              <circle
                cx={0}
                cy={-14}
                r={13}
                fill="none"
                stroke="#d9a521"
                strokeWidth={1.8}
                className="uf-marker-ring"
                style={{
                  animationPlayState: isActive ? "running" : "paused",
                  animationDelay: `${index * 0.45}s`,
                }}
              />
              <use href="#uf-rider-glyph" />
            </g>

            {/* Destination Beacon & Pulsing Target Ring */}
            <g transform={`translate(${ride.destination.x} ${ride.destination.y})`}>
              <circle
                cx={0}
                cy={0}
                r={14}
                fill="none"
                stroke="#3a1f0a"
                strokeWidth={1.5}
                className="uf-marker-ring"
                style={{
                  animationPlayState: isActive ? "running" : "paused",
                  animationDelay: `${ride.startDelay * 0.3}s`,
                }}
              />
              <use href="#uf-dest-glyph" />
            </g>

            {/* Autonomous Moving Cab with Smooth Cornering */}
            <g>
              <g transform="scale(1.12)">
                <circle r={13} fill="#F2CD7C" opacity={0.2} />
                <use href="#uf-car-glyph" />
              </g>
              <animateMotion
                dur={`${ride.duration}s`}
                begin={`${ride.startDelay}s`}
                repeatCount="indefinite"
                rotate="auto"
                calcMode="linear"
                path={ride.path}
                keyPoints={ride.keyPoints}
                keyTimes={ride.keyTimes}
              />
            </g>
          </g>
        ))}
      </svg>

      {/* Top, Bottom & Radial Depth Vignettes */}
      <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-[#f5e6c8]/90 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#c99a5a]/55 to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_48%,rgba(28,15,5,0.32)_100%)]" />
    </div>
  );
}

export default CityMapBackground;