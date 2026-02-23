'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface TabGroupProps {
  tabs: TabItem[];
  value: string;
  onChange: (tabId: string) => void;
  className?: string;
  'aria-label'?: string;
}

export function TabGroup({
  tabs,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: TabGroupProps) {
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    tabsRef.current = tabsRef.current.slice(0, tabs.length);
  }, [tabs.length]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      let nextIndex: number | null = null;

      if (e.key === 'ArrowRight') {
        nextIndex = (index + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft') {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = tabs.length - 1;
      }

      if (nextIndex !== null) {
        const nextTab = tabs[nextIndex];
        if (nextTab) {
          e.preventDefault();
          tabsRef.current[nextIndex]?.focus();
          onChange(nextTab.id);
        }
      }
    },
    [tabs, onChange],
  );

  return (
    <div
      className={cn('flex flex-wrap gap-2 mb-6', className)}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab, index) => {
        const isActive = value === tab.id;
        return (
          <Button
            key={tab.id}
            ref={(el) => {
              tabsRef.current[index] = el;
            }}
            type="button"
            role="tab"
            variant={isActive ? 'default' : 'outline'}
            size="sm"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              'flex items-center gap-2 transition-all duration-200 rounded-md',
              isActive
                ? 'bg-blue-600 text-white shadow-md hover:bg-blue-700'
                : 'bg-white text-gray-600 hover:bg-gray-50 border-gray-200',
            )}
          >
            {tab.icon && <span className="w-4 h-4">{tab.icon}</span>}
            {tab.label}
          </Button>
        );
      })}
    </div>
  );
}
