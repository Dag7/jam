import React from 'react';

interface StatusIndicatorProps {
  status: 'connected' | 'disconnected' | 'warning';
  label?: string;
}

const statusColors = {
  connected: 'bg-green-500',
  disconnected: 'bg-zinc-500',
  warning: 'bg-yellow-500',
};

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  label,
}) => {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
      {label && <span className="text-xs text-zinc-400">{label}</span>}
    </div>
  );
};
