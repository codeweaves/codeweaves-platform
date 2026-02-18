'use client';

import {
  createContext,
  useContext,
  useState,
  useMemo,
  type ReactNode,
} from 'react';

interface PageHeaderContextType {
  title: ReactNode;
  setTitle: (title: ReactNode) => void;
  actions: ReactNode | null;
  setActions: (actions: ReactNode | null) => void;
}

const PageHeaderCtx = createContext<PageHeaderContextType | undefined>(
  undefined,
);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<ReactNode>('');
  const [actions, setActions] = useState<ReactNode | null>(null);

  const value = useMemo(
    () => ({ title, setTitle, actions, setActions }),
    [title, actions],
  );

  return (
    <PageHeaderCtx.Provider value={value}>{children}</PageHeaderCtx.Provider>
  );
}

export function usePageHeader() {
  const context = useContext(PageHeaderCtx);
  if (!context) {
    throw new Error('usePageHeader must be used within a PageHeaderProvider');
  }
  return context;
}
