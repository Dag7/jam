import React from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 p-8">
          <div
            className="absolute top-0 left-0 right-0 h-8"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          />
          <div className="max-w-lg w-full space-y-4">
            <h2 className="text-lg font-semibold text-red-400">Something went wrong</h2>
            <pre className="text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-auto max-h-64 whitespace-pre-wrap">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
