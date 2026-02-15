import React from 'react';
import { TitleBar } from './TitleBar';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className="flex flex-col h-screen bg-surface">
      <TitleBar />
      <div className="flex flex-1 min-h-0">{children}</div>
    </div>
  );
};
