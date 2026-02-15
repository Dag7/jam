import React from 'react';

interface TerminalViewProps {
  containerRef: React.RefObject<HTMLDivElement>;
  isActive: boolean;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  containerRef,
  isActive,
}) => {
  return (
    <div
      className={`
        h-full w-full rounded-lg overflow-hidden border
        ${isActive ? 'border-zinc-700' : 'border-zinc-800'}
      `}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ padding: '4px' }}
      />
    </div>
  );
};
