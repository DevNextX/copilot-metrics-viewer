import { Options } from '@/model/Options';
import { createHash } from 'node:crypto';

export interface TeamMember {
  login: string;
  id: number;
  [key: string]: unknown;
}

export function normalizeTeamMember(item: unknown): TeamMember | null {
  if (!item || typeof item !== 'object') return null;

  const record = item as Record<string, unknown>;
  if (typeof record.login === 'string' && typeof record.id === 'number') {
    return record as TeamMember;
  }

  if (record.user && typeof record.user === 'object') {
    const user = record.user as Record<string, unknown>;
    if (typeof user.login === 'string' && typeof user.id === 'number') {
      return user as TeamMember;
    }
  }

  return null;
}

export function normalizeTeamMembers(items: unknown[]): TeamMember[] {
  return items.map((item) => normalizeTeamMember(item)).filter((member): member is TeamMember => Boolean(member));
}

const TEAM_MEMBERS_CACHE_TTL_MS = 5 * 60 * 1000;
const teamMembersCache = new Map<string, { expiresAt: number; value: TeamMember[] }>();
const teamMembersInflight = new Map<string, Promise<TeamMember[]>>();

export async function fetchAllTeamMembers(options: Options, headers: HeadersInit): Promise<TeamMember[]> {
  if (!options.githubTeam) {
    return [];
  }

  const cacheKey = buildTeamMembersCacheKey(options, headers);
  const cached = teamMembersCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return [...cached.value];

  const inflight = teamMembersInflight.get(cacheKey);
  if (inflight) return [...await inflight];

  const promise = fetchAllTeamMembersFromGitHub(options, headers)
    .then((members) => {
      teamMembersCache.set(cacheKey, { expiresAt: Date.now() + TEAM_MEMBERS_CACHE_TTL_MS, value: members });
      return members;
    })
    .finally(() => teamMembersInflight.delete(cacheKey));
  teamMembersInflight.set(cacheKey, promise);
  return [...await promise];
}

async function fetchAllTeamMembersFromGitHub(options: Options, headers: HeadersInit): Promise<TeamMember[]> {
  if (!options.githubTeam) {
    return [];
  }

  const membersUrl = options.getTeamMembersApiUrl();
  const perPage = 100;
  let page = 1;
  const members: TeamMember[] = [];

  const fetchHeaders: Record<string, string> = {};
  if (headers instanceof Headers) {
    for (const [key, value] of headers.entries()) {
      fetchHeaders[key] = value;
    }
  } else if (typeof headers === 'object') {
    Object.assign(fetchHeaders, headers);
  }

  if (options.scope === 'enterprise' && !options.githubOrg) {
    delete fetchHeaders['x-github-api-version'];
    fetchHeaders['X-GitHub-Api-Version'] = '2026-03-10';
  }

  while (true) {
    const pageData = await $fetch<unknown[]>(membersUrl, {
      headers: fetchHeaders,
      params: { per_page: perPage, page },
    });

    if (!Array.isArray(pageData) || pageData.length === 0) break;
    const pageMembers = normalizeTeamMembers(pageData);
    if (pageMembers.length === 0) {
      const error = new Error('Team member response did not contain parseable login and id values.') as Error & { statusCode?: number };
      error.statusCode = 503;
      throw error;
    }
    members.push(...pageMembers);
    if (pageData.length < perPage) break;
    page += 1;
  }

  return members;
}

function buildTeamMembersCacheKey(options: Options, headers: HeadersInit): string {
  return [
    getAuthCacheKey(headers),
    options.scope ?? '',
    options.githubOrg ?? '',
    options.githubEnt ?? '',
    options.githubTeam ?? '',
  ].join('|');
}

function getAuthCacheKey(headers: HeadersInit): string {
  let authorization = '';
  if (headers instanceof Headers) {
    authorization = headers.get('authorization') ?? headers.get('Authorization') ?? '';
  } else if (Array.isArray(headers)) {
    authorization = headers.find(([key]) => key.toLowerCase() === 'authorization')?.[1] ?? '';
  } else if (headers && typeof headers === 'object') {
    const record = headers as Record<string, string | undefined>;
    authorization = record.authorization ?? record.Authorization ?? '';
  }
  return authorization ? createHash('sha256').update(authorization).digest('hex').slice(0, 16) : 'anonymous';
}