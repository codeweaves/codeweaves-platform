'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { SearchableMultiSelect } from '@/components/ui/searchable-multi-select';
import { useAgents } from '@/hooks/use-agents';
import { useOrganizations } from '@/hooks/use-organizations';
import { useProfile } from '@/hooks/use-profile';
import type {
  ConversationSource,
  ConversationStatus,
} from '@/hooks/use-conversations';

export interface ConversationFilters {
  search: string;
  agentIds: string[];
  orgIds: string[];
  sources: ConversationSource[];
  statuses: ConversationStatus[];
  /** YYYY-MM-DD; empty string when unset. */
  dateFrom: string;
  /** YYYY-MM-DD; empty string when unset. */
  dateTo: string;
}

export const EMPTY_FILTERS: ConversationFilters = {
  search: '',
  agentIds: [],
  orgIds: [],
  sources: [],
  statuses: [],
  dateFrom: '',
  dateTo: '',
};

interface ConversationsFiltersBarProps {
  filters: ConversationFilters;
  onChange: (next: ConversationFilters) => void;
}

/**
 * Filter bar for the Conversations page. Visual + interaction parity with the
 * Analytics page filter row: DateRangePicker, SearchableMultiSelect (agents,
 * orgs), MultiSelect (sources, statuses). Each filter is `w-[250px]`, laid out
 * in a horizontal flex-wrap. Free-text search is the first item — Conversations
 * is the only page that supports message-content search so it doesn't have an
 * Analytics counterpart, but it shares the same Input style.
 */
export function ConversationsFiltersBar({
  filters,
  onChange,
}: ConversationsFiltersBarProps) {
  const { profile } = useProfile();
  const isAdmin =
    profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  const { data: agentsData } = useAgents({ limit: 100 });
  const { data: orgsData } = useOrganizations(
    { limit: 100 },
    { enabled: isAdmin },
  );

  // Local search state so we can debounce; commit upward 300ms after the user
  // stops typing. Mirrors the DataTable's internal search debounce so the API
  // doesn't get hit per-keystroke.
  const [searchLocal, setSearchLocal] = useState(filters.search);
  useEffect(() => {
    setSearchLocal(filters.search);
  }, [filters.search]);
  useEffect(() => {
    if (searchLocal === filters.search) return;
    const id = setTimeout(() => {
      onChange({ ...filters, search: searchLocal });
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchLocal]);

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Free-text search — message content, title, summary */}
      <div className="relative w-[250px]">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search conversations..."
          value={searchLocal}
          onChange={(e) => setSearchLocal(e.target.value)}
          className="pl-9 pr-9"
        />
        {searchLocal && (
          <button
            type="button"
            onClick={() => setSearchLocal('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <DateRangePicker
        fromValue={filters.dateFrom}
        toValue={filters.dateTo}
        onChange={(from, to) =>
          onChange({ ...filters, dateFrom: from, dateTo: to })
        }
        placeholder="Pick a date range"
      />

      <SearchableMultiSelect
        triggerClassName="w-[250px]"
        placeholder="All agents"
        searchPlaceholder="Search agents..."
        emptyMessage="No agents found"
        values={filters.agentIds}
        onValuesChange={(v) => onChange({ ...filters, agentIds: v })}
        selectedLabel={(n) => `${n} agents`}
        options={(agentsData?.data ?? []).map((a) => ({
          value: a.id,
          label: a.name,
        }))}
      />

      {isAdmin && orgsData?.data && (
        <SearchableMultiSelect
          triggerClassName="w-[250px]"
          placeholder="All organizations"
          searchPlaceholder="Search organizations..."
          emptyMessage="No organizations found"
          values={filters.orgIds}
          onValuesChange={(v) => onChange({ ...filters, orgIds: v })}
          selectedLabel={(n) => `${n} organizations`}
          options={orgsData.data.map((o) => ({
            value: o.id,
            label: o.name,
          }))}
        />
      )}

      <MultiSelect
        triggerClassName="w-[250px]"
        placeholder="All channels"
        values={filters.sources}
        onValuesChange={(v) =>
          onChange({ ...filters, sources: v as ConversationSource[] })
        }
        selectedLabel={(n) => `${n} channels`}
        options={[
          { value: 'WIDGET', label: 'Widget' },
          { value: 'WHATSAPP', label: 'WhatsApp' },
          { value: 'DEMO', label: 'Demo' },
        ]}
      />

      <MultiSelect
        triggerClassName="w-[250px]"
        placeholder="Any status"
        values={filters.statuses}
        onValuesChange={(v) =>
          onChange({ ...filters, statuses: v as ConversationStatus[] })
        }
        selectedLabel={(n) => `${n} statuses`}
        options={[
          { value: 'ACTIVE', label: 'Active' },
          { value: 'EXPIRED', label: 'Expired' },
        ]}
      />
    </div>
  );
}
