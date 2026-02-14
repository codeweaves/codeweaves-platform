import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  message?: string;
  fullScreen?: boolean;
}

export function LoadingSpinner({
  message = 'Loading...',
  fullScreen = true,
}: LoadingSpinnerProps) {
  return (
    <div
      className={`flex items-center justify-center ${fullScreen ? 'h-screen w-screen' : ''}`}
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <span className="ml-2 text-muted-foreground">{message}</span>
    </div>
  );
}
