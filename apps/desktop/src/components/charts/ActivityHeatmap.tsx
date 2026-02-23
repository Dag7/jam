interface ActivityHeatmapProps {
  /** Map of ISO date strings → count */
  data: Record<string, number>;
  weeks?: number;
  cellSize?: number;
  color?: string;
}

export function ActivityHeatmap({
  data,
  weeks = 12,
  cellSize = 10,
  color = '#3b82f6',
}: ActivityHeatmapProps) {
  const gap = 2;
  const totalDays = weeks * 7;
  const today = new Date();

  const days: Array<{ date: string; count: number; col: number; row: number }> = [];
  const maxCount = Math.max(...Object.values(data), 1);

  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayIndex = totalDays - 1 - i;
    days.push({
      date: dateStr,
      count: data[dateStr] ?? 0,
      col: Math.floor(dayIndex / 7),
      row: dayIndex % 7,
    });
  }

  const width = weeks * (cellSize + gap);
  const height = 7 * (cellSize + gap);

  return (
    <svg width={width} height={height}>
      {days.map((day) => {
        const intensity = day.count / maxCount;
        const opacity = day.count === 0 ? 0.05 : 0.15 + intensity * 0.85;

        return (
          <rect
            key={day.date}
            x={day.col * (cellSize + gap)}
            y={day.row * (cellSize + gap)}
            width={cellSize}
            height={cellSize}
            rx={2}
            fill={color}
            opacity={opacity}
          >
            <title>
              {day.date}: {day.count} tasks
            </title>
          </rect>
        );
      })}
    </svg>
  );
}
