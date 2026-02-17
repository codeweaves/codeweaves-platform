import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DataTableExpandToggleProps } from './types';

/**
 * Expand/collapse toggle button for expandable table rows.
 * Displays a chevron that rotates 90 degrees when expanded.
 * Shows an empty spacer when the row has no children to maintain alignment.
 */
export function DataTableExpandToggle({
  isExpanded,
  onToggle,
  hasChildren,
}: DataTableExpandToggleProps) {
  // Empty placeholder to maintain alignment when row has no children
  if (!hasChildren) {
    return <div className="h-8 w-8" />;
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 p-0"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={isExpanded}
      aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
    >
      <ChevronRight
        className={cn(
          'h-4 w-4 transition-transform duration-200',
          isExpanded && 'rotate-90'
        )}
      />
    </Button>
  );
}
