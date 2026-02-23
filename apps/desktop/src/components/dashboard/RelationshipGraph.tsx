interface RelationshipGraphProps {
  agents: Array<{ id: string; name: string; color: string }>;
  relationships: Array<{
    sourceAgentId: string;
    targetAgentId: string;
    trustScore: number;
  }>;
  onSelectAgent: (agentId: string) => void;
}

function getTrustColor(trust: number): string {
  if (trust > 0.7) return '#22c55e';
  if (trust >= 0.4) return '#eab308';
  return '#ef4444';
}

function getTrustWidth(trust: number): number {
  return 1 + trust * 2;
}

export function RelationshipGraph({
  agents,
  relationships,
  onSelectAgent,
}: RelationshipGraphProps) {
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 50;

  const agentPositions = agents.map((agent, i) => {
    const angle = (2 * Math.PI * i) / agents.length - Math.PI / 2;
    return {
      ...agent,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });

  const positionMap = new Map(agentPositions.map((a) => [a.id, a]));

  return (
    <div className="flex justify-center p-4">
      <svg width={size} height={size} className="overflow-visible">
        {/* Relationship lines */}
        {relationships.map((rel) => {
          const source = positionMap.get(rel.sourceAgentId);
          const target = positionMap.get(rel.targetAgentId);
          if (!source || !target) return null;
          return (
            <line
              key={`${rel.sourceAgentId}-${rel.targetAgentId}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={getTrustColor(rel.trustScore)}
              strokeWidth={getTrustWidth(rel.trustScore)}
              opacity={0.6}
            />
          );
        })}

        {/* Agent nodes */}
        {agentPositions.map((agent) => (
          <g
            key={agent.id}
            onClick={() => onSelectAgent(agent.id)}
            className="cursor-pointer"
          >
            <circle
              cx={agent.x}
              cy={agent.y}
              r={18}
              fill={agent.color}
              opacity={0.2}
              stroke={agent.color}
              strokeWidth={2}
            />
            <circle cx={agent.x} cy={agent.y} r={12} fill={agent.color} />
            <text
              x={agent.x}
              y={agent.y}
              textAnchor="middle"
              dominantBaseline="central"
              fill="white"
              fontSize={9}
              fontWeight="bold"
            >
              {agent.name.charAt(0).toUpperCase()}
            </text>
            <text
              x={agent.x}
              y={agent.y + 28}
              textAnchor="middle"
              fill="#d4d4d8"
              fontSize={10}
            >
              {agent.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
