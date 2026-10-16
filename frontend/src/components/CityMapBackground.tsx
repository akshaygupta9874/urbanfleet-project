import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";

type Point = { x: number; y: number };

type Ride = {
  points: Point[];
  duration: number;
  startDelay: number;
  pickupIndex: number;
  destinationIndex: number;
};

function CarGlyph() {
  return (
    <g>
      <ellipse cx={0} cy={0.8} rx={12} ry={4.2} fill="#1c0f05" opacity={0.16} />
      <rect x={-11} y={-5.5} width={22} height={11} rx={4} fill="#D9A521" stroke="#1c0f05" strokeWidth={1} />
      <rect x={-8} y={-6.3} width={3} height={1.6} rx={0.8} fill="#1c0f05" opacity={0.5} />
      <rect x={-8} y={4.7} width={3} height={1.6} rx={0.8} fill="#1c0f05" opacity={0.5} />
      <rect x={5} y={-6.3} width={3} height={1.6} rx={0.8} fill="#1c0f05" opacity={0.5} />
      <rect x={5} y={4.7} width={3} height={1.6} rx={0.8} fill="#1c0f05" opacity={0.5} />
      <rect x={1} y={-4} width={7} height={8} rx={2} fill="#1c0f05" opacity={0.55} />
      <circle cx={10.5} cy={-3} r={1} fill="#fff4dc" />
      <circle cx={10.5} cy={3} r={1} fill="#fff4dc" />
      <circle cx={-10.5} cy={-3} r={0.8} fill="#7a4416" />
      <circle cx={-10.5} cy={3} r={0.8} fill="#7a4416" />
    </g>
  );
}

function RiderGlyph() {
  return (
    <g>
      <path d="M0,0 C-8,-10 -9.5,-16 -9.5,-19.5 C-9.5,-25 -5.2,-29 0,-29 C5.2,-29 9.5,-25 9.5,-19.5 C9.5,-16 8,-10 0,0 Z" fill="#D9A521" stroke="#1c0f05" strokeWidth={1} />
      <circle cx={0} cy={-21} r={2.3} fill="#1c0f05" />
      <path d="M-3.4,-16.3 C-3.4,-19 3.4,-19 3.4,-16.3 L3.4,-13.8 C3.4,-12.6 -3.4,-12.6 -3.4,-13.8 Z" fill="#1c0f05" />
      <path d="M-6.2,-25 C-4.6,-27.3 -1.6,-28.8 1.4,-28.8" stroke="#F2CD7C" strokeWidth={1} fill="none" opacity={0.6} strokeLinecap="round" />
    </g>
  );
}

function calculateRide(ride: Ride) {
  const duration = ride.duration / 1.5;
  const distances = [0];
  for (let index = 1; index < ride.points.length; index += 1) {
    const previous = ride.points[index - 1];
    const current = ride.points[index];
    distances.push(distances[index - 1] + Math.hypot(current.x - previous.x, current.y - previous.y));
  }

  const totalDistance = distances[distances.length - 1];
  const pickupDistance = distances[ride.pickupIndex];
  const destinationDistance = distances[ride.destinationIndex];
  const pickupFraction = pickupDistance / totalDistance;
  const destinationFraction = destinationDistance / totalDistance;
  const pickupPause = 1.8;
  const destinationPause = 1.2;
  const speed = totalDistance / (duration - pickupPause - destinationPause);
  const pickupArrival = pickupDistance / speed;
  const pickupEnd = pickupArrival + pickupPause;
  const destinationArrival = pickupEnd + (destinationDistance - pickupDistance) / speed;
  const destinationEnd = destinationArrival + destinationPause;

  return {
    ...ride,
    duration,
    path: `M ${ride.points.map((point) => `${point.x} ${point.y}`).join(" L ")}`,
    pickup: ride.points[ride.pickupIndex],
    destination: ride.points[ride.destinationIndex],
    keyPoints: [0, pickupFraction, pickupFraction, destinationFraction, destinationFraction, 1].join(";"),
    keyTimes: [0, pickupArrival / duration, pickupEnd / duration, destinationArrival / duration, destinationEnd / duration, 1].join(";"),
    pickupFraction: pickupArrival / duration,
    destinationStart: destinationArrival / duration,
    destinationEnd: destinationEnd / duration,
  };
}

export function CityMapBackground() {
  const prefersReducedMotion = useReducedMotion();
  const verticals = useMemo(() => [70, 160, 260, 340, 430, 540, 620, 720, 820, 900, 1000, 1120], []);
  const horizontals = useMemo(() => [70, 150, 260, 330, 430, 500, 610, 700], []);
  const blockTones = ["#e8c98b", "#dbb271", "#efd8a3", "#cf9d55"];
  const rides = useMemo(
    () => [
      { points: [{ x: -50, y: 70 }, { x: 160, y: 70 }, { x: 430, y: 70 }, { x: 430, y: 260 }, { x: 540, y: 260 }], pickupIndex: 1, destinationIndex: 3, duration: 21, startDelay: 0 },
      { points: [{ x: 1250, y: 70 }, { x: 1000, y: 70 }, { x: 720, y: 70 }, { x: 720, y: 150 }, { x: 1250, y: 150 }], pickupIndex: 1, destinationIndex: 3, duration: 23, startDelay: 3 },
      { points: [{ x: 70, y: -50 }, { x: 70, y: 150 }, { x: 70, y: 330 }, { x: 260, y: 330 }, { x: 260, y: 500 }], pickupIndex: 1, destinationIndex: 3, duration: 20, startDelay: 6 },
      { points: [{ x: 1000, y: -50 }, { x: 1000, y: 150 }, { x: 1000, y: 330 }, { x: 820, y: 330 }, { x: 820, y: 500 }], pickupIndex: 1, destinationIndex: 3, duration: 22, startDelay: 9 },
      { points: [{ x: -50, y: 610 }, { x: 160, y: 610 }, { x: 340, y: 610 }, { x: 340, y: 700 }, { x: 620, y: 700 }], pickupIndex: 1, destinationIndex: 3, duration: 24, startDelay: 12 },
      { points: [{ x: 1250, y: 610 }, { x: 1120, y: 610 }, { x: 900, y: 610 }, { x: 900, y: 700 }, { x: 1250, y: 700 }], pickupIndex: 1, destinationIndex: 3, duration: 22, startDelay: 15 },
      { points: [{ x: 540, y: 870 }, { x: 540, y: 610 }, { x: 540, y: 430 }, { x: 620, y: 430 }, { x: 620, y: 260 }], pickupIndex: 1, destinationIndex: 3, duration: 25, startDelay: 18 },
    ] satisfies Ride[],
    [],
  ).map(calculateRide);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_15%,#fff7e6_0%,#f5e6c8_35%,#e6c893_65%,#c99a5a_100%)]" />
      <div className="absolute inset-0 opacity-[0.18] mix-blend-multiply" style={{ backgroundImage: "radial-gradient(rgba(80,45,15,0.35) 1px, transparent 1px), radial-gradient(rgba(80,45,15,0.2) 1px, transparent 1px)", backgroundSize: "3px 3px, 7px 7px", backgroundPosition: "0 0, 1px 2px" }} />
      <motion.div className="absolute -left-40 top-0 h-[560px] w-[560px] rounded-full bg-[#D9A521]/30 blur-[130px]" animate={prefersReducedMotion ? undefined : { x: [0, 60, -20, 0], y: [0, 40, -30, 0], scale: [1, 1.15, 0.9, 1] }} transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }} />
      <motion.div className="absolute -right-40 bottom-0 h-[560px] w-[560px] rounded-full bg-[#7a4416]/35 blur-[130px]" animate={prefersReducedMotion ? undefined : { x: [0, -60, 30, 0], y: [0, -40, 30, 0], scale: [1, 0.9, 1.2, 1] }} transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }} />
      <motion.svg viewBox="0 0 1200 820" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" animate={prefersReducedMotion ? undefined : { x: [0, -24, 0, 18, 0], y: [0, 10, 0, -8, 0] }} transition={{ duration: 40, repeat: Infinity, ease: "easeInOut" }}>
        <defs>
          <radialGradient id="cityMarkerGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#F2CD7C" stopOpacity="0.55" /><stop offset="100%" stopColor="#F2CD7C" stopOpacity="0" /></radialGradient>
          <pattern id="cityHatch" width={6} height={6} patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="6" stroke="#7a4416" strokeWidth="1" /></pattern>
        </defs>
        {verticals.slice(0, -1).map((vertical, column) => horizontals.slice(0, -1).map((horizontal, row) => {
          const width = verticals[column + 1] - vertical - 12;
          const height = horizontals[row + 1] - horizontal - 12;
          return <rect key={`block-${column}-${row}`} x={vertical + 6} y={horizontal + 6} width={width} height={height} rx={4} fill={blockTones[(column + row) % blockTones.length]} opacity={0.6} />;
        }))}
        <path d="M -50 700 C 150 650, 350 760, 620 690 S 1050 560, 1250 620 L 1250 820 L -50 820 Z" fill="#a0611f" opacity="0.32" />
        {verticals.map((vertical) => <line key={`street-v-${vertical}`} x1={vertical} y1={-20} x2={vertical} y2={900} stroke="#fff4dc" strokeWidth={8} />)}
        {horizontals.map((horizontal) => <line key={`street-h-${horizontal}`} x1={-20} y1={horizontal} x2={1220} y2={horizontal} stroke="#fff4dc" strokeWidth={8} />)}
        {verticals.map((vertical) => <line key={`mark-v-${vertical}`} x1={vertical} y1={-20} x2={vertical} y2={900} stroke="#6b3a12" strokeWidth={1} strokeDasharray="6 10" opacity={0.5} />)}
        {horizontals.map((horizontal) => <line key={`mark-h-${horizontal}`} x1={-20} y1={horizontal} x2={1220} y2={horizontal} stroke="#6b3a12" strokeWidth={1} strokeDasharray="6 10" opacity={0.5} />)}
        <g transform="translate(620 409)"><circle r={46} fill="none" stroke="#fff4dc" strokeWidth={10} opacity={0.9} /><circle r={30} fill="#e8c98b" stroke="#1c0f05" strokeWidth={1} opacity={0.7} /><circle r={30} fill="url(#cityHatch)" opacity={0.25} /></g>
        {rides.map((ride, index) => <g key={`ride-${index}`}>
          <g transform={`translate(${ride.pickup.x} ${ride.pickup.y})`}><circle cx={0} cy={-14} r={18} fill="url(#cityMarkerGlow)" />{!prefersReducedMotion && <motion.circle fill="none" stroke="#F2CD7C" strokeWidth={2} animate={{ r: [0, 8, 20, 8, 0], opacity: [0, 0.6, 0, 0.6, 0] }} transition={{ duration: 3, repeat: Infinity, delay: index * 0.4 }} />}<RiderGlyph /></g>
          {!prefersReducedMotion && <motion.circle cx={ride.destination.x} cy={ride.destination.y} fill="none" stroke="#D9A521" strokeWidth={2} animate={{ r: [0, 0, 10, 30, 0], opacity: [0, 0, 0.9, 0, 0] }} transition={{ duration: ride.duration, repeat: Infinity, delay: ride.startDelay }} />}
          {!prefersReducedMotion && <g><g transform="scale(1.15)"><circle r={13} fill="#F2CD7C" opacity={0.22} /><CarGlyph /></g><animateMotion dur={`${ride.duration}s`} begin={`${ride.startDelay}s`} repeatCount="indefinite" rotate="auto" calcMode="linear" path={ride.path} keyPoints={ride.keyPoints} keyTimes={ride.keyTimes} /></g>}
        </g>)}
      </motion.svg>
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#f5e6c8]/95 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#c99a5a]/60 to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(28,15,5,0.35)_100%)]" />
    </div>
  );
}

export default CityMapBackground;
