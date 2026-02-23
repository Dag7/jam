interface TraitRadarProps {
  traits: Record<string, number>;
  size?: number;
  color?: string;
}

export function TraitRadar({ traits, size = 160, color = '#3b82f6' }: TraitRadarProps) {
  const entries = Object.entries(traits);
  if (entries.length < 3) return null;

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 20;
  const angleStep = (2 * Math.PI) / entries.length;

  const dataPoints = entries.map(([, value], i) => {
    const angle = angleStep * i - Math.PI / 2;
    const r = value * radius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  });

  const polygon = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1.0];

  return (
    <svg width={size} height={size} className="overflow-visible">
      {/* Grid */}
      {rings.map((ring) => (
        <polygon
          key={ring}
          points={entries
            .map((_, i) => {
              const angle = angleStep * i - Math.PI / 2;
              const r = ring * radius;
              return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
            })
            .join(' ')}
          fill="none"
          stroke="#374151"
          strokeWidth={0.5}
        />
      ))}

      {/* Axes */}
      {entries.map(([, ], i) => {
        const angle = angleStep * i - Math.PI / 2;
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + radius * Math.cos(angle)}
            y2={cy + radius * Math.sin(angle)}
            stroke="#374151"
            strokeWidth={0.5}
          />
        );
      })}

      {/* Data polygon */}
      <polygon points={polygon} fill={color} opacity={0.2} stroke={color} strokeWidth={1.5} />

      {/* Data points */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
      ))}

      {/* Labels */}
      {entries.map(([name], i) => {
        const angle = angleStep * i - Math.PI / 2;
        const labelR = radius + 14;
        return (
          <text
            key={name}
            x={cx + labelR * Math.cos(angle)}
            y={cy + labelR * Math.sin(angle)}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#9ca3af"
            fontSize={9}
          >
            {name}
          </text>
        );
      })}
    </svg>
  );
}
