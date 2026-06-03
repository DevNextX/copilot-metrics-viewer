import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { Options } from '@/model/Options';
import type {
  BillingUsageDataState,
  BillingUsageModelDetail,
  BillingUsageModelOption,
  BillingUsageReport,
  BillingUsageSourceApi,
  BillingUsageSummary,
  BillingUsageTimeframe,
  BillingUsageTeamKind,
  BillingUsageUser,
  BillingUsageViewMode,
} from '../../shared/billing-usage';
import { fetchAllTeamMembers } from '../utils/team-members';

export interface RawBillingUsageActor {
  id?: number | string | null;
  login?: string | null;
  name?: string | null;
  avatar_url?: string | null;
}

export interface BillingUsageSeatUser {
  login: string;
  id?: number;
  avatarUrl?: string;
}

interface RawCopilotSeatItem {
  assignee?: RawBillingUsageActor | null;
}

interface RawCopilotSeatsResponse {
  total_seats?: number;
  seats?: RawCopilotSeatItem[];
}

export interface RawBillingUsageOrganization {
  id?: number | string | null;
  login?: string | null;
  name?: string | null;
}

export interface RawGitHubOrganizationResponse {
  login?: string | null;
  enterprise?: {
    slug?: string | null;
    url?: string | null;
    html_url?: string | null;
  } | null;
}

interface RawViewerEnterprisesResponse {
  data?: {
    viewer?: {
      enterprises?: {
        nodes?: Array<{
          slug?: string | null;
          organizations?: {
            nodes?: Array<{ login?: string | null }>;
          } | null;
        }>;
      } | null;
    } | null;
  } | null;
}

export interface RawPremiumRequestUsageItem {
  date?: string | null;
  product?: string | null;
  sku?: string | null;
  model?: string | null;
  user?: RawBillingUsageActor | string | null;
  organization?: RawBillingUsageOrganization | string | null;
  costCenterId?: string | null;
  unitType?: string | null;
  grossQuantity?: number | string | null;
  discountQuantity?: number | string | null;
  netQuantity?: number | string | null;
  grossAmount?: number | string | null;
  discountAmount?: number | string | null;
  netAmount?: number | string | null;
}

export interface RawPremiumRequestUsageResponse {
  usage?: RawPremiumRequestUsageItem[];
  usageItems?: RawPremiumRequestUsageItem[];
  user?: RawBillingUsageActor | string | null;
  totalGrossQuantity?: number | string | null;
  totalDiscountQuantity?: number | string | null;
  totalNetQuantity?: number | string | null;
  totalGrossAmount?: number | string | null;
  totalNetAmount?: number | string | null;
}

export interface RawBillingUsageItem {
  date?: string | null;
  product?: string | null;
  sku?: string | null;
  unitType?: string | null;
  quantity?: number | string | null;
  grossQuantity?: number | string | null;
  netQuantity?: number | string | null;
  amount?: number | string | null;
  grossAmount?: number | string | null;
  netAmount?: number | string | null;
  tokenType?: string | null;
  tokenCategory?: string | null;
  model?: string | null;
  user?: RawBillingUsageActor | string | null;
  organization?: RawBillingUsageOrganization | string | null;
}

export interface RawBillingUsageResponse {
  usage: RawBillingUsageItem[];
  nextPage?: string | null;
}

export interface RawBillingUsageSummaryItem {
  product?: string | null;
  sku?: string | null;
  unitType?: string | null;
  quantity?: number | string | null;
  amount?: number | string | null;
  grossAmount?: number | string | null;
  netAmount?: number | string | null;
}

export interface RawBillingUsageSummaryResponse {
  usage: RawBillingUsageSummaryItem[];
  totalAmount?: number | string | null;
}

export interface NormalizedRawUserRef {
  login?: string;
  id?: number;
  avatarUrl?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeRawUserRef(value: unknown): NormalizedRawUserRef | undefined {
  if (typeof value === 'string') {
    const login = readString(value);
    return login ? { login } : undefined;
  }

  if (!isRecord(value)) return undefined;

  const login = readString(value.login) ?? readString(value.name);
  const id = readNumber(value.id);
  const avatarUrl = readString(value.avatar_url);

  if (!login && id === undefined && !avatarUrl) return undefined;
  return { login, id, avatarUrl };
}

export function readModelKey(value: unknown): string | undefined {
  const model = readString(value);
  return model?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function hasTokenQuantityFields(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['quantity', 'grossQuantity', 'netQuantity'].some((field) => readNumber(value[field]) !== undefined);
}

export function hasAmountFields(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['amount', 'grossAmount', 'netAmount'].some((field) => readNumber(value[field]) !== undefined);
}

export interface BillingUsageRequestFilters {
  viewMode?: BillingUsageViewMode;
  model?: string;
  user?: string;
  timeframe?: string;
  sourceApi?: BillingUsageSourceApi;
}

export interface TeamMemberRef {
  login?: string;
  id?: number;
}

export interface BillingUsagePeriod {
  start: string;
  end: string;
  year: number;
  month?: number;
}

const require = createRequire(import.meta.url);
const GITHUB_API_VERSION = '2022-11-28';
const BILLING_USAGE_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const orgEnterpriseCache = new Map<string, CacheEntry<string | undefined>>();
const orgEnterpriseInflight = new Map<string, Promise<string | undefined>>();
const copilotSeatUsersCache = new Map<string, CacheEntry<BillingUsageSeatUser[]>>();
const copilotSeatUsersInflight = new Map<string, Promise<BillingUsageSeatUser[]>>();
const premiumRequestUserCache = new Map<string, CacheEntry<RawPremiumRequestUsageItem[]>>();
const premiumRequestUserInflight = new Map<string, Promise<RawPremiumRequestUsageItem[]>>();

export async function fetchBillingUsageReport(
  options: Options,
  headers: HeadersInit,
  filters: BillingUsageRequestFilters = {}
): Promise<BillingUsageReport> {
  const viewMode = filters.viewMode ?? 'ai_credit';
  const period = resolveBillingUsagePeriod(options, filters.timeframe);

  if (options.isDataMocked) {
    return buildMockBillingUsageReport(options, filters, period.start, period.end);
  }

  if (viewMode === 'token_usage') {
    return fetchLiveTokenUsageReport(options, headers, filters, period.start, period.end);
  }

  return fetchLivePremiumRequestReport(options, headers, filters, period.start, period.end);
}

export function resolveBillingUsagePeriod(options: Options, timeframe?: string, now = new Date()): BillingUsagePeriod {
  const normalized = normalizeBillingUsageTimeframe(timeframe);
  if (!normalized && options.since && options.until) {
    const end = new Date(options.until);
    return {
      start: options.since,
      end: options.until,
      year: end.getUTCFullYear(),
      month: end.getUTCMonth() + 1,
    };
  }

  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  if (normalized === 'this_year') return buildYearPeriod(currentYear);
  if (normalized === 'last_year') return buildYearPeriod(currentYear - 1);
  if (normalized === 'last_month') {
    const lastMonthDate = new Date(Date.UTC(currentYear, currentMonth - 1, 1));
    return buildMonthPeriod(lastMonthDate.getUTCFullYear(), lastMonthDate.getUTCMonth());
  }

  return buildMonthPeriod(currentYear, currentMonth);
}

function normalizeBillingUsageTimeframe(value?: string): BillingUsageTimeframe | undefined {
  if (value === 'current_month' || value === 'last_month' || value === 'this_year' || value === 'last_year') return value;
  return undefined;
}

function buildMonthPeriod(year: number, monthIndex: number): BillingUsagePeriod {
  const start = formatDate(year, monthIndex, 1);
  const end = formatDate(year, monthIndex, new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate());
  return { start, end, year, month: monthIndex + 1 };
}

function buildYearPeriod(year: number): BillingUsagePeriod {
  return { start: `${year}-01-01`, end: `${year}-12-31`, year };
}

function formatDate(year: number, monthIndex: number, day: number): string {
  const month = String(monthIndex + 1).padStart(2, '0');
  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

function buildBaseReport(
  options: Options,
  viewMode: BillingUsageViewMode,
  periodStart: string,
  periodEnd: string,
  sourceApi: BillingUsageSourceApi,
): Omit<BillingUsageReport, 'summary' | 'users' | 'modelOptions'> {
  const scope = options.scope ?? 'organization';
  const identifier = scope === 'enterprise' ? options.githubEnt ?? '' : options.githubOrg ?? '';
  const billingSourceScope = (viewMode === 'premium_request' || viewMode === 'ai_credit') && (scope === 'enterprise' || options.githubEnt)
    ? 'enterprise'
    : scope;
  const teamKind = getTeamKind(options);
  const teamFilterWarning = options.githubTeam
    ? 'Team filtering uses current team membership because GitHub Billing Usage APIs do not expose historical team attribution.'
    : undefined;

  return {
    scope,
    identifier,
    billingSourceScope,
    billingEnterpriseSlug: billingSourceScope === 'enterprise' ? options.githubEnt : undefined,
    teamSlug: options.githubTeam,
    teamKind,
    teamFilterMethod: options.githubTeam ? 'current_membership_post_filter' : 'none',
    teamFilterWarning,
    periodStart,
    periodEnd,
    generatedAt: new Date().toISOString(),
    source: options.isDataMocked ? 'mock' : 'github_billing_analytics',
    sourceApi,
    viewModes: [viewMode],
    dataState: 'complete',
    messages: [],
  };
}

function getTeamKind(options: Options): BillingUsageTeamKind | undefined {
  if (!options.githubTeam) return undefined;
  if (options.scope === 'enterprise' && !options.githubOrg) return 'enterprise_team';
  return 'organization_team';
}

function buildMockBillingUsageReport(
  options: Options,
  filters: BillingUsageRequestFilters,
  periodStart: string,
  periodEnd: string,
): BillingUsageReport {
  const viewMode = filters.viewMode ?? 'ai_credit';
  if (viewMode === 'token_usage' && filters.sourceApi === 'billing_usage_summary') {
    const aggregate = loadMockJson<RawBillingUsageSummaryResponse>('billing-usage-token-usage-aggregate-only.json');
    return normalizeAggregateTokenSummary(options, aggregate, periodStart, periodEnd, true);
  }

  if (viewMode === 'token_usage') {
    const raw = loadMockJson<RawBillingUsageResponse>('billing-usage-token-usage.json');
    return normalizeTokenUsage(options, raw.usage, periodStart, periodEnd, filters, true);
  }

  const file = options.scope === 'enterprise'
    ? 'billing-usage-enterprise-premium-request.json'
    : 'billing-usage-organization-premium-request.json';
  const raw = loadMockJson<RawPremiumRequestUsageResponse>(file);
  return normalizePremiumRequestUsage(options, raw.usage ?? [], periodStart, periodEnd, { ...filters, viewMode }, true);
}

function loadMockJson<T>(fileName: string): T {
  return JSON.parse(JSON.stringify(require(`../../public/mock-data/${fileName}`))) as T;
}

async function fetchLivePremiumRequestReport(
  options: Options,
  headers: HeadersInit,
  filters: BillingUsageRequestFilters,
  periodStart: string,
  periodEnd: string,
): Promise<BillingUsageReport> {
  const billingOptions = await resolvePremiumRequestBillingOptions(options, headers);
  const sourceApi = resolvePremiumRequestSourceApi(filters);
  const usageViewMode = resolveCreditViewMode(filters);

  if (!filters.user) {
    return fetchLivePremiumRequestUsersReport(billingOptions, headers, filters, periodStart, periodEnd);
  }

  const teamMembers = billingOptions.githubTeam ? await fetchAllTeamMembers(billingOptions, headers) : undefined;
  if (teamMembers) {
    if (teamMembers.length === 0) {
      return buildEmptyTeamFilteredReport(billingOptions, usageViewMode, periodStart, periodEnd, sourceApi, 0, 'The selected team has no current members.');
    }

    const requestedUser = filters.user.toLowerCase();
    const isTeamMember = normalizeTeamMemberRefs(teamMembers).some((member) => member.login?.toLowerCase() === requestedUser);
    if (!isTeamMember) {
      return buildEmptyTeamFilteredReport(billingOptions, usageViewMode, periodStart, periodEnd, sourceApi, teamMembers.length, 'The requested user is not a current member of the selected team.');
    }
  }

  const url = buildPremiumRequestUsageUrl(billingOptions, filters);
  const raw = await $fetch<RawPremiumRequestUsageResponse>(url, {
    headers: buildGitHubHeaders(headers),
    params: buildBillingUsageParams(billingOptions, filters),
  });

  const usageItems = readPremiumRequestUsageItems(raw, filters.user);
  const report = normalizePremiumRequestUsage(billingOptions, usageItems, periodStart, periodEnd, filters, false);
  return teamMembers ? applyTeamMemberFilter(report, teamMembers) : report;
}

async function resolvePremiumRequestBillingOptions(options: Options, headers: HeadersInit): Promise<Options> {
  if (options.scope !== 'organization' || options.githubEnt || !options.githubOrg) return options;

  const enterpriseSlug = await fetchOrganizationEnterpriseSlug(options.githubOrg, headers);
  if (!enterpriseSlug) return options;

  return new Options({ ...options.toObject(), githubEnt: enterpriseSlug });
}

export async function fetchOrganizationEnterpriseSlug(githubOrg: string, headers: HeadersInit): Promise<string | undefined> {
  const cacheKey = `${getAuthCacheKey(headers)}|org-enterprise|${githubOrg.toLowerCase()}`;
  const cached = orgEnterpriseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const inflight = orgEnterpriseInflight.get(cacheKey);
  if (inflight) return inflight;

  const promise = fetchOrganizationEnterpriseSlugUncached(githubOrg, headers)
    .then((slug) => {
      orgEnterpriseCache.set(cacheKey, { expiresAt: Date.now() + BILLING_USAGE_CACHE_TTL_MS, value: slug });
      return slug;
    })
    .finally(() => orgEnterpriseInflight.delete(cacheKey));
  orgEnterpriseInflight.set(cacheKey, promise);
  return promise;
}

async function fetchOrganizationEnterpriseSlugUncached(githubOrg: string, headers: HeadersInit): Promise<string | undefined> {
  try {
    const raw = await $fetch<RawGitHubOrganizationResponse>(`https://api.github.com/orgs/${githubOrg}`, {
      headers: buildGitHubHeaders(headers),
    });
    const restSlug = normalizeEnterpriseSlug(raw.enterprise);
    if (restSlug) return restSlug;
  } catch {
    // Fall through to GraphQL discovery. REST org metadata often omits enterprise ownership.
  }

  return fetchOrganizationEnterpriseSlugFromViewerEnterprises(githubOrg, headers);
}

function normalizeEnterpriseSlug(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const slug = readString(value.slug);
  if (slug) return slug;

  const enterpriseUrl = readString(value.url) ?? readString(value.html_url);
  return enterpriseUrl?.match(/\/enterprises\/([^/?#]+)/)?.[1];
}

async function fetchOrganizationEnterpriseSlugFromViewerEnterprises(githubOrg: string, headers: HeadersInit): Promise<string | undefined> {
  const query = `
    query($org: String!) {
      viewer {
        enterprises(first: 100) {
          nodes {
            slug
            organizations(first: 10, query: $org) {
              nodes { login }
            }
          }
        }
      }
    }
  `;

  try {
    const raw = await $fetch<RawViewerEnterprisesResponse>('https://api.github.com/graphql', {
      method: 'POST',
      headers: { ...buildGitHubHeaders(headers), 'Content-Type': 'application/json' },
      body: { query, variables: { org: githubOrg } },
    });

    const targetOrg = githubOrg.toLowerCase();
    const enterprises = raw.data?.viewer?.enterprises?.nodes ?? [];
    for (const enterprise of enterprises) {
      const slug = readString(enterprise.slug);
      const hasOrg = enterprise.organizations?.nodes?.some((org) => org.login?.toLowerCase() === targetOrg);
      if (slug && hasOrg) return slug;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function fetchLivePremiumRequestUsersReport(
  options: Options,
  headers: HeadersInit,
  filters: BillingUsageRequestFilters,
  periodStart: string,
  periodEnd: string,
): Promise<BillingUsageReport> {
  const fetchHeaders = buildGitHubHeaders(headers);
  const sourceApi = resolvePremiumRequestSourceApi(filters);
  const usageViewMode = resolveCreditViewMode(filters);
  const teamMembers = options.githubTeam ? await fetchAllTeamMembers(options, headers) : undefined;
  if (teamMembers?.length === 0) {
    return buildEmptyTeamFilteredReport(options, usageViewMode, periodStart, periodEnd, sourceApi, 0, 'The selected team has no current members.');
  }

  const candidateSeatOptions = resolvePremiumRequestCandidateSeatOptions(options);
  const seatUsers = await fetchAllCopilotSeatUsers(candidateSeatOptions, fetchHeaders);
  const users = teamMembers ? filterPremiumRequestCandidateUsers(seatUsers, teamMembers, filters.user) : seatUsers;

  if (teamMembers && users.length === 0) {
    return buildEmptyTeamFilteredReport(options, usageViewMode, periodStart, periodEnd, sourceApi, teamMembers.length, 'No current members of the selected team have Copilot seats for this billing scope.');
  }

  const usageItems: RawPremiumRequestUsageItem[] = [];
  const failedUsers: string[] = [];

  await mapWithConcurrency(users, 5, async (user) => {
    try {
      usageItems.push(...await fetchPremiumRequestUsageItemsForUser(options, fetchHeaders, filters, user));
    } catch {
      failedUsers.push(user.login);
    }
  });

  const report = normalizePremiumRequestUsage(options, usageItems, periodStart, periodEnd, filters, false);
  const withSeatUsers = addMissingSeatUsers(report, users);
  const messages = [...withSeatUsers.messages];
  let dataState = withSeatUsers.dataState;

  if (failedUsers.length > 0) {
    dataState = 'partial';
    messages.push(`${sourceApi === 'ai_credit_usage' ? 'AI credit usage' : 'Premium request usage'} could not be loaded for ${failedUsers.length} users.`);
  }

  const sortedUsers = sortUsers(withSeatUsers.users, usageViewMode);
  return {
    ...withSeatUsers,
    resolvedMemberCount: teamMembers?.length ?? withSeatUsers.resolvedMemberCount,
    dataState,
    messages,
    users: sortedUsers,
    summary: summarizeUsers(sortedUsers),
    modelOptions: buildModelOptions(sortedUsers),
  };
}

async function fetchPremiumRequestUsageItemsForUser(
  options: Options,
  headers: HeadersInit,
  filters: BillingUsageRequestFilters,
  user: BillingUsageSeatUser,
): Promise<RawPremiumRequestUsageItem[]> {
  const cacheKey = buildPremiumRequestUserCacheKey(options, headers, filters, user.login);
  const cached = premiumRequestUserCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return clonePremiumRequestUsageItems(cached.value);

  const inflight = premiumRequestUserInflight.get(cacheKey);
  if (inflight) return clonePremiumRequestUsageItems(await inflight);

  const promise = fetchPremiumRequestUsageItemsForUserUncached(options, headers, filters, user)
    .then((items) => {
      premiumRequestUserCache.set(cacheKey, { expiresAt: Date.now() + BILLING_USAGE_CACHE_TTL_MS, value: items });
      return items;
    })
    .finally(() => premiumRequestUserInflight.delete(cacheKey));
  premiumRequestUserInflight.set(cacheKey, promise);
  return clonePremiumRequestUsageItems(await promise);
}

function resolvePremiumRequestCandidateSeatOptions(options: Options): Options {
  if (options.scope === 'enterprise' && options.githubOrg) {
    return new Options({ ...options.toObject(), scope: 'organization' });
  }

  return options;
}

async function fetchPremiumRequestUsageItemsForUserUncached(
  options: Options,
  headers: HeadersInit,
  filters: BillingUsageRequestFilters,
  user: BillingUsageSeatUser,
): Promise<RawPremiumRequestUsageItem[]> {
  const raw = await $fetch<RawPremiumRequestUsageResponse>(buildPremiumRequestUsageUrl(options, filters), {
    headers,
    params: buildBillingUsageParams(options, { ...filters, user: user.login }),
  });
  return readPremiumRequestUsageItems(raw, toRawBillingUsageActor(user));
}

function clonePremiumRequestUsageItems(items: RawPremiumRequestUsageItem[]): RawPremiumRequestUsageItem[] {
  return items.map((item) => ({ ...item }));
}

function buildCopilotSeatUsersCacheKey(options: Options, headers: HeadersInit): string {
  return [
    getAuthCacheKey(headers),
    'seats',
    options.scope ?? '',
    options.githubOrg ?? '',
    options.githubEnt ?? '',
  ].join('|');
}

function buildPremiumRequestUserCacheKey(options: Options, headers: HeadersInit, filters: BillingUsageRequestFilters, user: string): string {
  const period = resolveBillingUsagePeriod(options, filters.timeframe);
  return [
    getAuthCacheKey(headers),
    'premium-request-user',
    buildPremiumRequestUsageUrl(options, filters),
    options.githubOrg ?? '',
    String(period.year),
    String(period.month ?? ''),
    filters.model ?? '',
    user.toLowerCase(),
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

function readPremiumRequestUsageItems(raw: RawPremiumRequestUsageResponse, requestedUser?: RawBillingUsageActor | string): RawPremiumRequestUsageItem[] {
  const items = raw.usage ?? raw.usageItems ?? [];
  const fallbackUser = raw.user ?? requestedUser;
  if (!fallbackUser) return items;
  return items.map((item) => item.user ? item : { ...item, user: fallbackUser });
}

async function fetchAllCopilotSeatUsers(options: Options, headers: HeadersInit): Promise<BillingUsageSeatUser[]> {
  const cacheKey = buildCopilotSeatUsersCacheKey(options, headers);
  const cached = copilotSeatUsersCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return [...cached.value];

  const inflight = copilotSeatUsersInflight.get(cacheKey);
  if (inflight) return [...await inflight];

  const promise = fetchAllCopilotSeatUsersUncached(options, headers)
    .then((users) => {
      copilotSeatUsersCache.set(cacheKey, { expiresAt: Date.now() + BILLING_USAGE_CACHE_TTL_MS, value: users });
      return users;
    })
    .finally(() => copilotSeatUsersInflight.delete(cacheKey));
  copilotSeatUsersInflight.set(cacheKey, promise);
  return [...await promise];
}

async function fetchAllCopilotSeatUsersUncached(options: Options, headers: HeadersInit): Promise<BillingUsageSeatUser[]> {
  const usersByKey = new Map<string, BillingUsageSeatUser>();
  const perPage = 100;
  let page = 1;

  while (true) {
    const response = await $fetch<RawCopilotSeatsResponse>(options.getSeatsApiUrl(), {
      headers,
      params: { per_page: perPage, page },
    });
    const seats = response.seats ?? [];

    for (const seat of seats) {
      const user = normalizeSeatUser(seat);
      if (!user) continue;
      usersByKey.set(user.id !== undefined ? `id:${user.id}` : `login:${user.login.toLowerCase()}`, user);
    }

    if (seats.length < perPage) break;
    if (response.total_seats && page >= Math.ceil(response.total_seats / perPage)) break;
    page += 1;
  }

  return [...usersByKey.values()].sort((left, right) => left.login.localeCompare(right.login));
}

function normalizeSeatUser(seat: RawCopilotSeatItem): BillingUsageSeatUser | undefined {
  const assignee = normalizeRawUserRef(seat.assignee);
  if (!assignee?.login) return undefined;
  return { login: assignee.login, id: assignee.id, avatarUrl: assignee.avatarUrl };
}

function toRawBillingUsageActor(user: BillingUsageSeatUser): RawBillingUsageActor {
  return { login: user.login, id: user.id, avatar_url: user.avatarUrl };
}

export function normalizeTeamMemberRefs(members: unknown[]): TeamMemberRef[] {
  return members
    .map((member) => {
      if (isRecord(member) && isRecord(member.user)) return normalizeRawUserRef(member.user);
      return normalizeRawUserRef(member);
    })
    .filter((member): member is TeamMemberRef => Boolean(member?.login || member?.id !== undefined));
}

export function filterPremiumRequestCandidateUsers(
  users: BillingUsageSeatUser[],
  members: unknown[],
  requestedUser?: string,
): BillingUsageSeatUser[] {
  const normalizedMembers = normalizeTeamMemberRefs(members);
  const memberLogins = new Set(normalizedMembers.map((member) => member.login?.toLowerCase()).filter(Boolean));
  const memberIds = new Set(normalizedMembers.map((member) => member.id).filter((id): id is number => id !== undefined));
  const requestedLogin = requestedUser?.toLowerCase();

  return users.filter((user) => {
    const belongsToTeam = memberIds.has(user.id ?? -1) || memberLogins.has(user.login.toLowerCase());
    const matchesRequestedUser = !requestedLogin || user.login.toLowerCase() === requestedLogin;
    return belongsToTeam && matchesRequestedUser;
  });
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const promise = worker(item).finally(() => executing.delete(promise));
    executing.add(promise);
    if (executing.size >= concurrency) await Promise.race(executing);
  }
  await Promise.all(executing);
}

function addMissingSeatUsers(report: BillingUsageReport, seatUsers: BillingUsageSeatUser[]): BillingUsageReport {
  const existingLogins = new Set(report.users.map((user) => user.login.toLowerCase()));
  const missingUsers: BillingUsageUser[] = seatUsers
    .filter((user) => !existingLogins.has(user.login.toLowerCase()))
    .map((user) => ({
      login: user.login,
      userId: user.id,
      avatarUrl: user.avatarUrl,
      aiCredits: 0,
      includedCredits: 0,
      additionalCredits: 0,
      premiumRequests: 0,
      includedRequests: 0,
      billedRequests: 0,
      grossAmountUsd: 0,
      additionalUsageUsd: 0,
      billedAmountUsd: 0,
      models: [],
    }));

  const users = [...report.users, ...missingUsers];
  return {
    ...report,
    users,
    summary: summarizeUsers(users),
    modelOptions: buildModelOptions(users),
  };
}

function buildEmptyTeamFilteredReport(
  options: Options,
  viewMode: BillingUsageViewMode,
  periodStart: string,
  periodEnd: string,
  sourceApi: BillingUsageSourceApi,
  resolvedMemberCount: number,
  message: string,
): BillingUsageReport {
  const base = buildBaseReport(options, viewMode, periodStart, periodEnd, sourceApi);
  return {
    ...base,
    resolvedMemberCount,
    dataState: 'complete',
    messages: [message, ...base.messages],
    summary: summarizeUsers([]),
    users: [],
    modelOptions: [],
  };
}

async function fetchLiveTokenUsageReport(
  options: Options,
  headers: HeadersInit,
  filters: BillingUsageRequestFilters,
  periodStart: string,
  periodEnd: string,
): Promise<BillingUsageReport> {
  const fetchHeaders = buildGitHubHeaders(headers);
  if (filters.sourceApi === 'billing_usage_summary') {
    const summary = await $fetch<RawBillingUsageSummaryResponse>(buildBillingUsageSummaryUrl(options), {
      headers: fetchHeaders,
      params: buildBillingUsageParams(options, filters),
    });
    return normalizeAggregateTokenSummary(options, summary, periodStart, periodEnd, false);
  }

  try {
    const raw = await $fetch<RawBillingUsageResponse>(buildBillingUsageUrl(options), {
      headers: fetchHeaders,
      params: buildBillingUsageParams(options, filters),
    });
    const report = normalizeTokenUsage(options, raw.usage ?? [], periodStart, periodEnd, filters, false);
    if (report.dataState !== 'unavailable') return report;
  } catch (error) {
    if (filters.sourceApi === 'billing_usage') throw error;
  }

  const summary = await $fetch<RawBillingUsageSummaryResponse>(buildBillingUsageSummaryUrl(options), {
    headers: fetchHeaders,
    params: buildBillingUsageParams(options, filters),
  });
  return normalizeAggregateTokenSummary(options, summary, periodStart, periodEnd, false);
}

function buildPremiumRequestUsageUrl(options: Options, filters: BillingUsageRequestFilters = {}): string {
  const baseUrl = 'https://api.github.com';
  const sourceApi = resolvePremiumRequestSourceApi(filters);
  const usagePathSegment = sourceApi === 'ai_credit_usage' ? 'ai_credit' : 'premium_request';
  // Use enterprise endpoint when: enterprise scope, OR org-within-enterprise (githubEnt available).
  // GitHub's per-user premium request billing is only exposed at the enterprise level for GHEC orgs.
  const useEnterprise = options.scope === 'enterprise' || Boolean(options.githubEnt);
  if (useEnterprise) {
    if (!options.githubEnt) throw new Error('GitHub enterprise must be set for enterprise billing usage');
    return `${baseUrl}/enterprises/${options.githubEnt}/settings/billing/${usagePathSegment}/usage`;
  }
  if (!options.githubOrg) throw new Error('GitHub organization must be set for organization billing usage');
  return `${baseUrl}/organizations/${options.githubOrg}/settings/billing/${usagePathSegment}/usage`;
}

function resolvePremiumRequestSourceApi(filters: BillingUsageRequestFilters): BillingUsageSourceApi {
  if (filters.sourceApi === 'premium_request_usage') return 'premium_request_usage';
  if (filters.viewMode === 'premium_request') return 'premium_request_usage';
  return 'ai_credit_usage';
}

function resolveCreditViewMode(filters: BillingUsageRequestFilters): BillingUsageViewMode {
  return resolvePremiumRequestSourceApi(filters) === 'ai_credit_usage' ? 'ai_credit' : 'premium_request';
}

function buildBillingUsageUrl(options: Options): string {
  const baseUrl = 'https://api.github.com';
  if (options.scope === 'enterprise' && !options.githubOrg) {
    if (!options.githubEnt) throw new Error('GitHub enterprise must be set for enterprise billing usage');
    return `${baseUrl}/enterprises/${options.githubEnt}/settings/billing/usage`;
  }
  const org = options.githubOrg;
  if (!org) throw new Error('GitHub organization must be set for organization billing usage');
  return `${baseUrl}/organizations/${org}/settings/billing/usage`;
}

function buildBillingUsageSummaryUrl(options: Options): string {
  return `${buildBillingUsageUrl(options)}/summary`;
}

function buildGitHubHeaders(headers: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (headers instanceof Headers) {
    for (const [key, value] of headers.entries()) result[key] = value;
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) result[key] = value;
  } else if (headers) {
    Object.assign(result, headers);
  }
  delete result['x-github-api-version'];
  result['X-GitHub-Api-Version'] = GITHUB_API_VERSION;
  result.Accept = result.Accept ?? 'application/vnd.github+json';
  return result;
}

function buildBillingUsageParams(
  options: Options,
  filters: BillingUsageRequestFilters,
): Record<string, string> {
  const period = resolveBillingUsagePeriod(options, filters.timeframe);
  const params: Record<string, string> = {
    year: String(period.year),
  };
  if (period.month) params.month = String(period.month);
  // Add organization filter for enhanced token billing only. AI Credit and legacy Premium Request
  // follow billing-entity semantics, and per-user calls cannot be combined with organization.
  if (filters.viewMode === 'token_usage' && options.githubOrg && !filters.user && (options.scope === 'enterprise' || options.githubEnt)) params.organization = options.githubOrg;
  if (filters.model) params.model = filters.model;
  if (filters.user) params.user = filters.user;
  return params;
}

export function normalizePremiumRequestUsage(
  options: Options,
  rawItems: RawPremiumRequestUsageItem[],
  periodStart: string,
  periodEnd: string,
  filters: BillingUsageRequestFilters = {},
  isMock = false,
): BillingUsageReport {
  const sourceApi = isMock ? 'mock' : resolvePremiumRequestSourceApi(filters);
  const viewMode = isMock ? filters.viewMode ?? 'ai_credit' : resolveCreditViewMode(filters);
  const base = buildBaseReport(new Options({ ...options.toObject(), isDataMocked: isMock }), viewMode, periodStart, periodEnd, sourceApi);
  const filtered = filterByModel(rawItems, filters.model);
  const usersByKey = new Map<string, BillingUsageUser>();
  const hasUserDimension = filtered.some((item) => Boolean(normalizeRawUserRef(item.user))) || Boolean(normalizeRawUserRef(filters.user));

  for (const item of filtered) {
    const userRef = normalizeRawUserRef(item.user) ?? normalizeRawUserRef(filters.user);
    const login = userRef?.login ?? 'unknown-user';
    const userKey = userRef?.id !== undefined ? `id:${userRef.id}` : `login:${login}`;
    const model = readString(item.model) ?? 'Unknown model';
    const modelKey = readModelKey(model) ?? 'unknown-model';
    const grossQuantity = readNumber(item.grossQuantity) ?? 0;
    const discountQuantity = readNumber(item.discountQuantity) ?? 0;
    const netQuantity = readNumber(item.netQuantity) ?? grossQuantity;
    const grossAmount = readNumber(item.grossAmount) ?? 0;
    const netAmount = readNumber(item.netAmount) ?? readNumber(item.grossAmount) ?? 0;

    const user = usersByKey.get(userKey) ?? {
      login,
      userId: userRef?.id,
      avatarUrl: userRef?.avatarUrl,
      organizationLogin: normalizeOrganizationLogin(item.organization),
      aiCredits: 0,
      includedCredits: 0,
      additionalCredits: 0,
      premiumRequests: 0,
      includedRequests: 0,
      billedRequests: 0,
      grossAmountUsd: 0,
      additionalUsageUsd: 0,
      billedAmountUsd: 0,
      models: [],
    };

    user.aiCredits = (user.aiCredits ?? 0) + grossQuantity;
    user.includedCredits = (user.includedCredits ?? 0) + discountQuantity;
    user.additionalCredits = (user.additionalCredits ?? 0) + netQuantity;
    user.premiumRequests = (user.premiumRequests ?? 0) + grossQuantity;
    user.includedRequests = (user.includedRequests ?? 0) + discountQuantity;
    user.billedRequests = (user.billedRequests ?? 0) + netQuantity;
    user.grossAmountUsd = (user.grossAmountUsd ?? 0) + grossAmount;
    user.additionalUsageUsd = (user.additionalUsageUsd ?? 0) + netAmount;
    user.billedAmountUsd = (user.billedAmountUsd ?? 0) + netAmount;

    const modelDetail = getOrCreateModelDetail(user.models, model, modelKey);
    modelDetail.aiCredits = (modelDetail.aiCredits ?? 0) + grossQuantity;
    modelDetail.includedCredits = (modelDetail.includedCredits ?? 0) + discountQuantity;
    modelDetail.additionalCredits = (modelDetail.additionalCredits ?? 0) + netQuantity;
    modelDetail.premiumRequests = (modelDetail.premiumRequests ?? 0) + grossQuantity;
    modelDetail.includedRequests = (modelDetail.includedRequests ?? 0) + discountQuantity;
    modelDetail.billedRequests = (modelDetail.billedRequests ?? 0) + netQuantity;
    modelDetail.grossAmountUsd = (modelDetail.grossAmountUsd ?? 0) + grossAmount;
    modelDetail.additionalUsageUsd = (modelDetail.additionalUsageUsd ?? 0) + netAmount;
    modelDetail.billedAmountUsd = (modelDetail.billedAmountUsd ?? 0) + netAmount;

    usersByKey.set(userKey, user);
  }

  const users = sortUsers([...usersByKey.values()], viewMode);
  const messages: string[] = [];
  let dataState: BillingUsageDataState = 'complete';
  if (filtered.length > 0 && !hasUserDimension) {
    dataState = 'partial';
    const sourceLabel = sourceApi === 'ai_credit_usage' ? 'AI Credit Usage' : 'Premium Request Usage';
    messages.push(`GitHub ${sourceLabel} returned aggregate records without user identifiers. Query with user={login}, or enumerate users and query each user, to build user-level rows.`);
  }

  return applyTeamFilterIfNeeded({
    ...base,
    dataState,
    messages,
    summary: summarizeUsers(users),
    users,
    modelOptions: buildModelOptions(users),
  }, options);
}

export function normalizeTokenUsage(
  options: Options,
  rawItems: RawBillingUsageItem[],
  periodStart: string,
  periodEnd: string,
  filters: BillingUsageRequestFilters = {},
  isMock = false,
): BillingUsageReport {
  const base = buildBaseReport(new Options({ ...options.toObject(), isDataMocked: isMock }), 'token_usage', periodStart, periodEnd, isMock ? 'mock' : 'billing_usage');
  const copilotTokenItems = filterByModel(rawItems, filters.model).filter(isCopilotTokenUsageItem);
  const usersByKey = new Map<string, BillingUsageUser>();

  for (const item of copilotTokenItems) {
    const userRef = normalizeRawUserRef(item.user);
    if (!userRef?.login && userRef?.id === undefined) continue;
    const login = userRef.login ?? `user-${userRef.id}`;
    const userKey = userRef.id !== undefined ? `id:${userRef.id}` : `login:${login}`;
    const model = readString(item.model) ?? 'Unknown model';
    const modelKey = readModelKey(model) ?? 'unknown-model';
    const quantity = readNumber(item.quantity) ?? readNumber(item.netQuantity) ?? readNumber(item.grossQuantity) ?? 0;
    const amount = readNumber(item.amount) ?? readNumber(item.netAmount) ?? 0;
    const tokenBucket = getTokenBucket(item);

    const user = usersByKey.get(userKey) ?? {
      login,
      userId: userRef.id,
      avatarUrl: userRef.avatarUrl,
      organizationLogin: normalizeOrganizationLogin(item.organization),
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
      models: [],
    };

    addTokenQuantity(user, tokenBucket, quantity, amount);
    const modelDetail = getOrCreateModelDetail(user.models, model, modelKey);
    addTokenQuantity(modelDetail, tokenBucket, quantity, amount);
    usersByKey.set(userKey, user);
  }

  const users = sortUsers([...usersByKey.values()], 'token_usage');
  const messages: string[] = [];
  let dataState: BillingUsageDataState = 'complete';
  if (copilotTokenItems.length === 0) {
    dataState = 'unavailable';
    messages.push('GitHub Billing Usage did not return Copilot token usage records for this scope and period.');
  } else if (users.length === 0) {
    dataState = 'partial';
    messages.push('Token usage was available only as aggregate records without user/model dimensions.');
  }

  return applyTeamFilterIfNeeded({
    ...base,
    dataState,
    messages,
    summary: summarizeUsers(users),
    users,
    modelOptions: buildModelOptions(users),
  }, options);
}

export function normalizeAggregateTokenSummary(
  options: Options,
  raw: RawBillingUsageSummaryResponse,
  periodStart: string,
  periodEnd: string,
  isMock = false,
): BillingUsageReport {
  const base = buildBaseReport(new Options({ ...options.toObject(), isDataMocked: isMock }), 'token_usage', periodStart, periodEnd, isMock ? 'mock' : 'billing_usage_summary');
  const summary: BillingUsageSummary = { totalUsers: 0, totalTokens: 0, estimatedCostUsd: readNumber(raw.totalAmount) ?? 0 };

  for (const item of raw.usage.filter(isCopilotTokenUsageItem)) {
    const quantity = readNumber(item.quantity) ?? 0;
    const amount = readNumber(item.amount) ?? readNumber(item.netAmount) ?? 0;
    addTokenQuantity(summary, getTokenBucket(item), quantity, amount);
  }

  return {
    ...base,
    dataState: 'partial',
    messages: ['GitHub Billing Usage returned aggregate token totals only. Per-user and per-model token rows are unavailable for this response.'],
    summary,
    users: [],
    modelOptions: [],
  };
}

function filterByModel<T extends { model?: string | null }>(items: T[], model?: string): T[] {
  const modelKey = readModelKey(model);
  if (!modelKey) return items;
  return items.filter((item) => readModelKey(item.model) === modelKey);
}

function isCopilotTokenUsageItem(item: RawBillingUsageItem | RawBillingUsageSummaryItem): boolean {
  const product = readString(item.product)?.toLowerCase() ?? '';
  const sku = readString(item.sku)?.toLowerCase() ?? '';
  const unitType = readString(item.unitType)?.toLowerCase() ?? '';
  return (product.includes('copilot') || sku.includes('copilot')) && unitType.includes('token');
}

function getTokenBucket(item: RawBillingUsageItem | RawBillingUsageSummaryItem): 'input' | 'output' | 'cached' | 'cache_write' | 'total' {
  const unitType = readString(item.unitType)?.toLowerCase() ?? '';
  const tokenType = 'tokenType' in item ? readString(item.tokenType)?.toLowerCase() ?? '' : '';
  const tokenCategory = 'tokenCategory' in item ? readString(item.tokenCategory)?.toLowerCase() ?? '' : '';
  const combined = `${unitType} ${tokenType} ${tokenCategory}`;
  if (combined.includes('cache_write') || combined.includes('cache-write') || combined.includes('write')) return 'cache_write';
  if (combined.includes('cached')) return 'cached';
  if (combined.includes('output') || combined.includes('completion')) return 'output';
  if (combined.includes('input') || combined.includes('prompt')) return 'input';
  return 'total';
}

function addTokenQuantity(
  target: BillingUsageUser | BillingUsageModelDetail | BillingUsageSummary,
  bucket: 'input' | 'output' | 'cached' | 'cache_write' | 'total',
  quantity: number,
  amount: number,
): void {
  target.totalTokens = (target.totalTokens ?? 0) + quantity;
  target.estimatedCostUsd = (target.estimatedCostUsd ?? 0) + amount;
  if (bucket === 'input') target.inputTokens = (target.inputTokens ?? 0) + quantity;
  if (bucket === 'output') target.outputTokens = (target.outputTokens ?? 0) + quantity;
  if (bucket === 'cached') target.cachedTokens = (target.cachedTokens ?? 0) + quantity;
  if (bucket === 'cache_write') target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + quantity;
}

function getOrCreateModelDetail(models: BillingUsageModelDetail[], model: string, modelKey: string): BillingUsageModelDetail {
  let existing = models.find((item) => item.modelKey === modelKey);
  if (!existing) {
    existing = { model, modelKey };
    models.push(existing);
  }
  return existing;
}

function sortUsers(users: BillingUsageUser[], viewMode: BillingUsageViewMode): BillingUsageUser[] {
  const sorted = users.map((user) => ({
    ...user,
    models: [...user.models].sort((left, right) => (right.totalTokens ?? right.aiCredits ?? right.premiumRequests ?? 0) - (left.totalTokens ?? left.aiCredits ?? left.premiumRequests ?? 0)),
  }));
  if (viewMode === 'token_usage') return sorted.sort((left, right) => (right.totalTokens ?? 0) - (left.totalTokens ?? 0));
  return sorted.sort((left, right) => (right.aiCredits ?? right.premiumRequests ?? 0) - (left.aiCredits ?? left.premiumRequests ?? 0));
}

function summarizeUsers(users: BillingUsageUser[]): BillingUsageSummary {
  return users.reduce<BillingUsageSummary>((summary, user) => ({
    totalUsers: summary.totalUsers + 1,
    totalAiCredits: (summary.totalAiCredits ?? 0) + (user.aiCredits ?? user.premiumRequests ?? 0),
    totalIncludedCredits: (summary.totalIncludedCredits ?? 0) + (user.includedCredits ?? user.includedRequests ?? 0),
    totalAdditionalCredits: (summary.totalAdditionalCredits ?? 0) + (user.additionalCredits ?? user.billedRequests ?? 0),
    totalPremiumRequests: (summary.totalPremiumRequests ?? 0) + (user.premiumRequests ?? 0),
    totalIncludedRequests: (summary.totalIncludedRequests ?? 0) + (user.includedRequests ?? 0),
    totalBilledRequests: (summary.totalBilledRequests ?? 0) + (user.billedRequests ?? 0),
    totalTokens: (summary.totalTokens ?? 0) + (user.totalTokens ?? 0),
    totalInputTokens: (summary.totalInputTokens ?? 0) + (user.inputTokens ?? 0),
    totalOutputTokens: (summary.totalOutputTokens ?? 0) + (user.outputTokens ?? 0),
    totalCachedTokens: (summary.totalCachedTokens ?? 0) + (user.cachedTokens ?? 0),
    totalCacheWriteTokens: (summary.totalCacheWriteTokens ?? 0) + (user.cacheWriteTokens ?? 0),
    grossAmountUsd: (summary.grossAmountUsd ?? 0) + (user.grossAmountUsd ?? 0),
    additionalUsageUsd: (summary.additionalUsageUsd ?? 0) + (user.additionalUsageUsd ?? user.billedAmountUsd ?? 0),
    billedAmountUsd: (summary.billedAmountUsd ?? 0) + (user.billedAmountUsd ?? 0),
    estimatedCostUsd: (summary.estimatedCostUsd ?? 0) + (user.estimatedCostUsd ?? 0),
  }), { totalUsers: 0 });
}

function buildModelOptions(users: BillingUsageUser[]): BillingUsageModelOption[] {
  const models = new Map<string, string>();
  for (const user of users) {
    for (const model of user.models) models.set(model.modelKey, model.model);
  }
  return [...models.entries()].map(([modelKey, model]) => ({ model, modelKey })).sort((left, right) => left.model.localeCompare(right.model));
}

function normalizeOrganizationLogin(value: unknown): string | undefined {
  if (typeof value === 'string') return readString(value);
  if (!isRecord(value)) return undefined;
  return readString(value.login) ?? readString(value.name);
}

function applyTeamFilterIfNeeded(report: BillingUsageReport, options: Options): BillingUsageReport {
  if (!options.githubTeam || options.isDataMocked !== true) return report;
  const members = loadMockTeamMembers(options);
  return applyTeamMemberFilter(report, members);
}

export function applyTeamMemberFilter(report: BillingUsageReport, members: unknown[]): BillingUsageReport {
  const normalizedMembers = normalizeTeamMemberRefs(members);
  if (normalizedMembers.length === 0) {
    const users: BillingUsageUser[] = [];
    return {
      ...report,
      dataState: 'complete',
      resolvedMemberCount: 0,
      messages: [...report.messages, 'The selected team has no current members.'],
      users,
      summary: summarizeUsers(users),
      modelOptions: [],
    };
  }

  const memberLogins = new Set(normalizedMembers.map((member) => member.login?.toLowerCase()).filter(Boolean));
  const memberIds = new Set(normalizedMembers.map((member) => member.id).filter((id): id is number => id !== undefined));
  if (report.users.length === 0 && report.dataState === 'partial') {
    return {
      ...report,
      resolvedMemberCount: normalizedMembers.length,
      messages: [...report.messages, 'Team filtering requires user-level billing records; aggregate-only token data cannot be narrowed by team.'],
    };
  }
  const users = report.users.filter((user) => memberIds.has(user.userId ?? -1) || memberLogins.has(user.login.toLowerCase()));
  return {
    ...report,
    resolvedMemberCount: normalizedMembers.length,
    users,
    summary: summarizeUsers(users),
    modelOptions: buildModelOptions(users),
  };
}

function loadMockTeamMembers(options: Options): TeamMemberRef[] {
  const data = loadMockJson<{
    organizationTeam: { members: Array<RawBillingUsageActor> };
    enterpriseTeam: { memberships: Array<{ user: RawBillingUsageActor }> };
    enterpriseOrganizationOverrideTeam: { members: Array<RawBillingUsageActor> };
  }>('billing-usage-team-members.json');

  if (options.scope === 'enterprise' && !options.githubOrg) {
    return data.enterpriseTeam.memberships.map((item) => normalizeRawUserRef(item.user)).filter((item): item is TeamMemberRef => Boolean(item));
  }
  if (options.scope === 'enterprise' && options.githubOrg) {
    return data.enterpriseOrganizationOverrideTeam.members.map((item) => normalizeRawUserRef(item)).filter((item): item is TeamMemberRef => Boolean(item));
  }
  return data.organizationTeam.members.map((item) => normalizeRawUserRef(item)).filter((item): item is TeamMemberRef => Boolean(item));
}