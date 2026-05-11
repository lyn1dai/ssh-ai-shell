import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import { normalizeSavedCommandScopeList } from '../utils/savedCommandScope';

type ScopeValue = {
  targetHostIds?: string[];
  targetGroups?: string[];
};

type HostItem = {
  id: string;
  name: string;
  host: string;
  username: string;
  group?: string;
};

interface Props {
  value: ScopeValue;
  onChange: (next: ScopeValue) => void;
  className?: string;
}

export default function SavedCommandScopeEditor({ value, onChange, className = '' }: Props) {
  const [hosts, setHosts] = React.useState<HostItem[]>([]);
  const [hostSearch, setHostSearch] = React.useState('');
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const loadOptions = useCallback(() => {
    fetch('/api/hosts')
      .then(r => r.json())
      .then(data => setHosts(Array.isArray(data) ? data : []))
      .catch(() => setHosts([]));
  }, []);

  useEffect(() => {
    loadOptions();
    window.addEventListener('hosts-updated', loadOptions);
    return () => window.removeEventListener('hosts-updated', loadOptions);
  }, [loadOptions]);

  useEffect(() => {
    if (!pickerOpen) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [pickerOpen]);

  const targetHostIds = normalizeSavedCommandScopeList(value.targetHostIds);
  const targetGroups = normalizeSavedCommandScopeList(value.targetGroups);
  const allSelected = targetHostIds.length === 0 && targetGroups.length === 0;

  const sortedHosts = useMemo(() => [...hosts].sort((a, b) => {
    const groupCompare = (a.group || '').localeCompare(b.group || '', 'zh-CN');
    if (groupCompare !== 0) return groupCompare;
    return a.name.localeCompare(b.name, 'zh-CN');
  }), [hosts]);

  const filteredHosts = useMemo(() => {
    const keyword = hostSearch.trim().toLowerCase();
    if (!keyword) return sortedHosts;
    return sortedHosts.filter(host =>
      [host.name, host.host, host.username, host.group || '']
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    );
  }, [hostSearch, sortedHosts]);

  const selectedHosts = useMemo(() => {
    const selectedIdSet = new Set(targetHostIds);
    return sortedHosts.filter(host => selectedIdSet.has(host.id));
  }, [sortedHosts, targetHostIds]);

  const availableHosts = useMemo(() => {
    if (allSelected) return filteredHosts;
    const selectedIdSet = new Set(targetHostIds);
    return filteredHosts.filter(host => !selectedIdSet.has(host.id));
  }, [allSelected, filteredHosts, targetHostIds]);

  function addHost(hostId: string) {
    onChange({
      targetHostIds: allSelected ? [hostId] : [...targetHostIds, hostId],
      targetGroups: allSelected ? [] : targetGroups,
    });
  }

  function removeHost(hostId: string) {
    onChange({
      targetHostIds: targetHostIds.filter(id => id !== hostId),
      targetGroups,
    });
  }

  function removeGroup(groupPath: string) {
    onChange({
      targetHostIds,
      targetGroups: targetGroups.filter(item => item !== groupPath),
    });
  }

  function restoreAllHosts() {
    onChange({ targetHostIds: [], targetGroups: [] });
    setPickerOpen(false);
  }

  return (
    <div ref={rootRef} className={`relative ${className}`.trim()}>
      <div className="flex items-start gap-2">
        <div className="pt-1 text-[10px] text-terminal-muted whitespace-nowrap">适用机器</div>

        <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
          {allSelected ? (
            <button
              type="button"
              onClick={restoreAllHosts}
              className="inline-flex items-center gap-1 rounded-full border border-terminal-blue/30 bg-terminal-blue/10 px-2 py-0.5 text-[10px] text-terminal-blue"
            >
              <Check className="h-2.5 w-2.5" />
              全部机器
            </button>
          ) : (
            <>
              {selectedHosts.map(host => (
                <button
                  key={host.id}
                  type="button"
                  onClick={() => removeHost(host.id)}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-terminal-border bg-terminal-surface px-2 py-0.5 text-[10px] text-terminal-text transition-colors hover:border-terminal-red/35 hover:text-terminal-red"
                  title={`移除 ${host.name}`}
                >
                  <span className="truncate max-w-[140px]">{host.name}</span>
                  <X className="h-2.5 w-2.5 flex-shrink-0" />
                </button>
              ))}

              {targetGroups.map(group => (
                <button
                  key={group}
                  type="button"
                  onClick={() => removeGroup(group)}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-terminal-border bg-terminal-surface px-2 py-0.5 text-[10px] text-terminal-muted transition-colors hover:border-terminal-red/35 hover:text-terminal-red"
                  title={`移除分组 ${group}`}
                >
                  <span className="truncate max-w-[140px]">{group}</span>
                  <X className="h-2.5 w-2.5 flex-shrink-0" />
                </button>
              ))}

              {selectedHosts.length === 0 && targetGroups.length === 0 && (
                <button
                  type="button"
                  onClick={restoreAllHosts}
                  className="inline-flex items-center rounded-full border border-terminal-border bg-terminal-surface px-2 py-0.5 text-[10px] text-terminal-muted transition-colors hover:border-terminal-blue/35 hover:text-terminal-text"
                >
                  恢复全部机器
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => setPickerOpen(prev => !prev)}
            className={`inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-full border px-1.5 text-[10px] transition-colors ${
              pickerOpen
                ? 'border-terminal-blue/35 bg-terminal-blue/10 text-terminal-blue'
                : 'border-terminal-border bg-terminal-surface text-terminal-muted hover:border-terminal-blue/35 hover:text-terminal-text'
            }`}
            title="添加机器"
          >
            <Plus className="h-2.5 w-2.5" />
            <ChevronDown className={`h-2.5 w-2.5 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {pickerOpen && (
        <div className="absolute left-0 top-full z-30 mt-2 w-[320px] max-w-[min(320px,100vw-32px)] rounded-xl border border-terminal-border bg-terminal-surface shadow-[0_12px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <div className="border-b border-terminal-border/70 px-3 py-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-terminal-border bg-terminal-bg px-2 py-1.5">
              <Search className="h-3 w-3 flex-shrink-0 text-terminal-muted" />
              <input
                type="text"
                value={hostSearch}
                onChange={e => setHostSearch(e.target.value)}
                placeholder="搜索主机名、地址..."
                className="w-full bg-transparent text-[11px] text-terminal-text placeholder:text-terminal-muted/60 outline-none"
              />
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto p-2">
            {allSelected && (
              <button
                type="button"
                onClick={restoreAllHosts}
                className="mb-1 flex w-full items-center gap-2 rounded-lg border border-terminal-blue/30 bg-terminal-blue/10 px-2.5 py-2 text-left text-[11px] text-terminal-blue"
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-terminal-blue text-white">
                  <Check className="h-2.5 w-2.5" />
                </span>
                <span className="min-w-0 flex-1">全部机器</span>
              </button>
            )}

            {availableHosts.length > 0 ? (
              <div className="space-y-1">
                {availableHosts.map(host => (
                  <label
                    key={host.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-terminal-blue/20 hover:bg-terminal-bg"
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-terminal-border bg-terminal-bg text-terminal-blue"
                      checked={false}
                      onChange={() => addHost(host.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] text-terminal-text">{host.name}</div>
                      <div className="truncate text-[10px] text-terminal-muted">
                        {host.username}@{host.host}{host.group ? ` · ${host.group}` : ''}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-terminal-border px-3 py-4 text-center text-[10px] text-terminal-muted">
                {allSelected
                  ? '没有匹配主机'
                  : '没有更多可添加的主机'}
              </div>
            )}
          </div>

          {!allSelected && (
            <div className="border-t border-terminal-border/70 px-3 py-2">
              <button
                type="button"
                onClick={restoreAllHosts}
                className="text-[10px] text-terminal-muted transition-colors hover:text-terminal-blue"
              >
                恢复为全部机器
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
