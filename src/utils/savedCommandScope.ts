import type { ConnectConfig, SavedCommand } from '../types';

type ScopeLike = Pick<SavedCommand, 'targetHostIds' | 'targetGroups'>;

type HostLike = Pick<ConnectConfig, 'hostId' | 'group'> | { id?: string; group?: string };

const LEGACY_SCOPE_TOKENS = new Set([
  'scope',
  'visible to all hosts and groups',
  'visible to all hosts',
  'visible to all groups',
  'all hosts and groups',
  'all hosts',
  'all groups',
  'all',
  'target hosts',
  'target groups',
  '全部机器',
  '全部主机',
  '全部分组',
  '所有主机和分组',
]);

export function normalizeSavedCommandScopeList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return Array.from(new Set(list
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(item => {
      if (!item) return false;
      return !LEGACY_SCOPE_TOKENS.has(item.toLowerCase());
    })));
}

export function hasSavedCommandScopeFilters(scope: ScopeLike): boolean {
  return normalizeSavedCommandScopeList(scope.targetHostIds).length > 0
    || normalizeSavedCommandScopeList(scope.targetGroups).length > 0;
}

export function matchesSavedCommandScope(scope: ScopeLike, host: HostLike | null | undefined): boolean {
  const targetHostIds = normalizeSavedCommandScopeList(scope.targetHostIds);
  const targetGroups = normalizeSavedCommandScopeList(scope.targetGroups);

  if (targetHostIds.length === 0 && targetGroups.length === 0) return true;
  if (!host) return false;

  const hostId = ('hostId' in host ? host.hostId : ('id' in host ? host.id : '')) || '';
  const group = host.group || '';

  if (hostId && targetHostIds.includes(hostId)) return true;
  if (group && targetGroups.some(target => group === target || group.startsWith(`${target}/`))) return true;
  return false;
}

export function getSavedCommandScopeSummary(scope: ScopeLike): string {
  const hostCount = normalizeSavedCommandScopeList(scope.targetHostIds).length;
  const groupCount = normalizeSavedCommandScopeList(scope.targetGroups).length;

  if (hostCount === 0 && groupCount === 0) return '全部机器';
  if (hostCount > 0 && groupCount > 0) return `${hostCount} 台机器 + ${groupCount} 个分组`;
  if (hostCount > 0) return `${hostCount} 台机器`;
  return `${groupCount} 个分组`;
}

export function collectKnownGroupPaths(
  hosts: Array<{ group?: string | null }>,
  standaloneGroups: string[] = [],
): string[] {
  const set = new Set<string>();

  for (const group of standaloneGroups) {
    if (!group) continue;
    const parts = group.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i += 1) {
      set.add(parts.slice(0, i + 1).join('/'));
    }
  }

  for (const host of hosts) {
    const group = (host.group || '').trim();
    if (!group) continue;
    const parts = group.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i += 1) {
      set.add(parts.slice(0, i + 1).join('/'));
    }
  }

  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
