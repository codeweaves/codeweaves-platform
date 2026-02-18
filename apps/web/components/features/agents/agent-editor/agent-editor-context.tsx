'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { Agent } from '@/hooks/use-agents';

export interface AgentFormData {
  name: string;
  // Admin-only fields
  systemPrompt: string;
  welcomeMessage: string;
  allowedDomains: string[];
  webhookUrl: string;
  // Branding (placeholder — stored in AgentTheme in Epic 4)
  brandingEnabled: boolean;
  brandingTextPrefix: string;
  brandingLinkText: string;
  brandingLinkUrl: string;
}

interface AgentEditorContextType {
  agent: Agent;
  formData: AgentFormData;
  savedFormData: AgentFormData;
  updateFormData: <K extends keyof AgentFormData>(
    field: K,
    value: AgentFormData[K],
  ) => void;
  hasUnsavedChanges: boolean;
  resetToSaved: () => void;
  markSaved: (data: AgentFormData) => void;
}

const AgentEditorContext = createContext<AgentEditorContextType | undefined>(
  undefined,
);

export function useAgentEditor() {
  const context = useContext(AgentEditorContext);
  if (!context) {
    throw new Error(
      'useAgentEditor must be used within an AgentEditorProvider',
    );
  }
  return context;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;

  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
  );
}

export function agentToFormData(
  agent: Agent,
  webhookUrl = '',
): AgentFormData {
  return {
    name: agent.name,
    systemPrompt: agent.systemPrompt ?? '',
    welcomeMessage: agent.welcomeMessage ?? '',
    allowedDomains: agent.allowedDomains ?? [],
    webhookUrl,
    brandingEnabled: true,
    brandingTextPrefix: 'Powered by',
    brandingLinkText: 'Codeweaves',
    brandingLinkUrl: 'https://codeweaves.com',
  };
}

interface AgentEditorProviderProps {
  children: ReactNode;
  agent: Agent;
  initialFormData: AgentFormData;
}

export function AgentEditorProvider({
  children,
  agent,
  initialFormData,
}: AgentEditorProviderProps) {
  const [savedFormData, setSavedFormData] =
    useState<AgentFormData>(initialFormData);
  const [formData, setFormData] = useState<AgentFormData>(initialFormData);

  const updateFormData = useCallback(
    <K extends keyof AgentFormData>(field: K, value: AgentFormData[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const hasUnsavedChanges = useMemo(
    () => !deepEqual(formData, savedFormData),
    [formData, savedFormData],
  );

  const resetToSaved = useCallback(() => {
    setFormData(savedFormData);
  }, [savedFormData]);

  const markSaved = useCallback((data: AgentFormData) => {
    setSavedFormData(data);
    setFormData(data);
  }, []);

  return (
    <AgentEditorContext.Provider
      value={{
        agent,
        formData,
        savedFormData,
        updateFormData,
        hasUnsavedChanges,
        resetToSaved,
        markSaved,
      }}
    >
      {children}
    </AgentEditorContext.Provider>
  );
}
