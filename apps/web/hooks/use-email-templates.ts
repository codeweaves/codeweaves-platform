'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

export interface EmailTemplateVariable {
  key: string;
  label: string;
  sample: string;
}

export interface EmailTemplateSummary {
  key: string;
  name: string;
  description: string | null;
  subject: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface EmailTemplateDetail extends EmailTemplateSummary {
  html: string;
  variables: EmailTemplateVariable[];
}

/**
 * Template list for the left pane. Copy changes are rare and SUPER_ADMIN-only,
 * so a long staleTime keeps this off the network on every navigation.
 */
export function useEmailTemplates() {
  const { isAuthenticated } = useAuth();
  const api = useApiClient();
  return useQuery<EmailTemplateSummary[]>({
    queryKey: ['email-templates'],
    queryFn: () => api.get('/email-templates'),
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });
}

/** One template with its html body + variable descriptors. */
export function useEmailTemplate(key: string | null) {
  const { isAuthenticated } = useAuth();
  const api = useApiClient();
  return useQuery<EmailTemplateDetail>({
    queryKey: ['email-templates', key],
    queryFn: () => api.get(`/email-templates/${key}`),
    enabled: isAuthenticated && !!key,
  });
}

export function useUpdateEmailTemplate() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      key,
      subject,
      html,
    }: {
      key: string;
      subject: string;
      html: string;
    }) => api.patch(`/email-templates/${key}`, { subject, html }),
    onSuccess: (_data, { key }) => {
      qc.invalidateQueries({ queryKey: ['email-templates', key] });
      qc.invalidateQueries({ queryKey: ['email-templates'], exact: true });
    },
  });
}

/**
 * Client-side render of the editor preview.
 *
 * Deliberately local rather than a server round-trip: the preview updates as
 * you type, and a request per keystroke would be both slow and pointless. The
 * substitution rules mirror EmailTemplateService — only declared variables
 * resolve, values are HTML-escaped, single pass — so what you see matches what
 * the backend will actually render.
 */
export function renderTemplatePreview(
  html: string,
  variables: EmailTemplateVariable[],
): string {
  const samples = new Map(variables.map((v) => [v.key, v.sample]));
  return html.replace(
    /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
    (_match, name: string) => {
      const value = samples.get(name);
      return value === undefined ? '' : escapeHtml(value);
    },
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
