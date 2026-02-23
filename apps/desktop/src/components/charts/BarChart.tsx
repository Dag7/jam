interface BarChartItem {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarChartItem[];
  height?: number;
  showLabels?: boolean;
}

export function BarChart({ data, height = 120, showLabels = true }: BarChartProps) {
  if (data.length === 0) return null;

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const barWidth = Math.max(12, Math.min(32, 200 / data.length));
  const gap = 4;
  const totalWidth = data.length * (barWidth + gap) - gap;

  return (
    <svg width={totalWidth} height={height + (showLabels ? 20 : 0)} className="overflow-visible">
      {data.map((item, i) => {
        const barHeight = (item.value / maxValue) * height;
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        return (
          <g key={item.label}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={2}
              fill={item.color ?? '#3b82f6'}
              opacity={0.8}
            />
            {showLabels && (
              <text
                x={x + barWidth / 2}
                y={height + 14}
                textAnchor="middle"
                fill="#9ca3af"
                fontSize={9}
              >
                {item.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
