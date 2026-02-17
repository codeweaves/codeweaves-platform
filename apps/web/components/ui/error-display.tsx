import { AlertTriangle } from 'lucide-react';

interface ErrorDisplayProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  onLogout?: () => void;
}

export function ErrorDisplay({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again.',
  onRetry,
  onLogout,
}: ErrorDisplayProps) {
  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-muted-foreground">{message}</p>
        <div className="flex gap-3">
          {onRetry && (
            <button
              onClick={onRetry}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Try Again
            </button>
          )}
          {onLogout && (
            <button
              onClick={onLogout}
              className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              Log Out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
