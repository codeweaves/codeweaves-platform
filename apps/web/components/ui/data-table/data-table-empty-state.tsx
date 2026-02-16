import type { DataTableEmptyStateConfig } from './data-table.types';

interface DataTableEmptyStateProps {
  config: DataTableEmptyStateConfig;
}

export function DataTableEmptyState({ config }: DataTableEmptyStateProps) {
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
      {Icon && <Icon className="h-12 w-12 text-muted-foreground/50" />}
      <h3 className="mt-4 text-lg font-semibold">{config.title}</h3>
      {config.description && (
        <p className="mt-2 text-sm text-muted-foreground">
          {config.description}
        </p>
      )}
      {config.action && <div className="mt-4">{config.action}</div>}
    </div>
  );
}
