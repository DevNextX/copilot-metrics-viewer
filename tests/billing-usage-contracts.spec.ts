import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BillingUsageReport } from '../shared/billing-usage';
import {
  applyTeamMemberFilter,
  fetchBillingUsageReport,
  filterPremiumRequestCandidateUsers,
  hasAmountFields,
  hasTokenQuantityFields,
  normalizeTeamMemberRefs,
  normalizeRawUserRef,
  normalizePremiumRequestUsage,
  normalizeTokenUsage,
  readModelKey,
  readNumber,
  readString,
  resolveBillingUsagePeriod,
} from '../server/services/github-copilot-billing-usage-api';
import type {
  RawBillingUsageResponse,
  RawBillingUsageSummaryResponse,
  RawPremiumRequestUsageResponse,
} from '../server/services/github-copilot-billing-usage-api';
import { Options } from '../app/model/Options';

const require = createRequire(import.meta.url);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Billing usage Phase 1 contracts', () => {
  it('supports the shared report shape for both view modes', () => {
    const report: BillingUsageReport = {
      scope: 'organization',
      identifier: 'mocked-org',
      periodStart: '2026-04-03',
      periodEnd: '2026-04-30',
      generatedAt: '2026-04-30T00:00:00.000Z',
      source: 'mock',
      sourceApi: 'mock',
      viewModes: ['premium_request', 'token_usage'],
      summary: {
        totalUsers: 1,
        totalPremiumRequests: 40,
        totalTokens: 1670000,
      },
      users: [
        {
          login: 'octocat',
          userId: 101,
          premiumRequests: 40,
          totalTokens: 1670000,
          models: [
            {
              model: 'gpt-4.1',
              modelKey: 'gpt-4-1',
              premiumRequests: 40,
              totalTokens: 1670000,
            },
          ],
        },
      ],
      modelOptions: [{ model: 'gpt-4.1', modelKey: 'gpt-4-1' }],
      dataState: 'complete',
      messages: [],
    };

    expect(report.viewModes).toContain('premium_request');
    expect(report.viewModes).toContain('token_usage');
    expect(report.users[0].models[0].modelKey).toBe('gpt-4-1');
  });

  it('loads premium request mock data for organization and enterprise scopes', () => {
    const org = require('../public/mock-data/billing-usage-organization-premium-request.json') as RawPremiumRequestUsageResponse;
    const ent = require('../public/mock-data/billing-usage-enterprise-premium-request.json') as RawPremiumRequestUsageResponse;

    expect(org.usage).toHaveLength(3);
    expect(ent.usage).toHaveLength(3);
    expect(org.usage[0].unitType).toBe('requests');
    expect(ent.usage[0].organization).toMatchObject({ login: 'platform-org' });
    expect(readNumber(org.totalNetQuantity)).toBe(95);
  });

  it('normalizes live premium request usageItems responses with a requested user fallback', () => {
    const report = normalizePremiumRequestUsage(
      new Options({ scope: 'enterprise', githubEnt: 'test-enterprise-lc-april' }),
      [
        {
          product: 'copilot',
          sku: 'copilot_enterprise',
          model: 'gpt-4.1',
          unitType: 'requests',
          grossQuantity: 2,
          discountQuantity: 0,
          netQuantity: 2,
          grossAmount: 0,
          netAmount: 0,
        },
      ],
      '2026-05-01',
      '2026-05-07',
      { user: 'LF-AIF' },
      false,
    );

    expect(report.dataState).toBe('complete');
    expect(report.users).toHaveLength(1);
    expect(report.users[0].login).toBe('LF-AIF');
    expect(report.summary.totalPremiumRequests).toBe(2);
  });

  it('routes organization premium request lookups through enterprise billing when enterprise context is available', async () => {
    const fetchMock = vi.fn(async (url: string, init?: { params?: Record<string, string> }) => {
      if (url.includes('/copilot/billing/seats')) {
        return { seats: [{ assignee: { id: 1, login: 'octocat' } }] };
      }

      expect(url).toBe('https://api.github.com/enterprises/test-enterprise/settings/billing/premium_request/usage');
      expect(init?.params).toMatchObject({ user: 'octocat', year: '2026', month: '5' });
      expect(init?.params?.organization).toBeUndefined();
      return {
        usageItems: [
          {
            model: 'gpt-4.1',
            grossQuantity: 7,
            discountQuantity: 0,
            netQuantity: 7,
            grossAmount: 0,
            netAmount: 0,
          },
        ],
      };
    });
    vi.stubGlobal('$fetch', fetchMock);

    const report = await fetchBillingUsageReport(
      new Options({ scope: 'organization', githubOrg: 'test-org', githubEnt: 'test-enterprise', since: '2026-05-01', until: '2026-05-31' }),
      new Headers({ Authorization: 'Bearer test-token' }),
      { viewMode: 'premium_request' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(report.users[0].login).toBe('octocat');
    expect(report.summary.totalPremiumRequests).toBe(7);
  });

  it('uses organization seats for enterprise scope with an organization override while keeping enterprise billing', async () => {
    const fetchCalls: Array<{ url: string; params?: Record<string, string> }> = [];
    const fetchMock = vi.fn(async (url: string, init?: { params?: Record<string, string> }) => {
      fetchCalls.push({ url, params: init?.params });

      if (url.includes('/copilot/billing/seats')) {
        expect(url).toBe('https://api.github.com/orgs/override-org/copilot/billing/seats');
        return { seats: [{ assignee: { id: 41, login: 'org-seat-user' } }] };
      }

      expect(url).toBe('https://api.github.com/enterprises/override-ent/settings/billing/premium_request/usage');
      expect(init?.params).toMatchObject({ user: 'org-seat-user', year: '2026', month: '5' });
      expect(init?.params?.organization).toBeUndefined();
      return {
        usageItems: [
          {
            model: 'gpt-4.1',
            grossQuantity: 13,
            discountQuantity: 0,
            netQuantity: 13,
            grossAmount: 0,
            netAmount: 0,
          },
        ],
      };
    });
    vi.stubGlobal('$fetch', fetchMock);

    const report = await fetchBillingUsageReport(
      new Options({ scope: 'enterprise', githubEnt: 'override-ent', githubOrg: 'override-org', since: '2026-05-01', until: '2026-05-31' }),
      new Headers({ Authorization: 'Bearer override-token' }),
      { viewMode: 'premium_request' },
    );

    expect(fetchCalls.map((call) => call.url)).toContain('https://api.github.com/orgs/override-org/copilot/billing/seats');
    expect(fetchCalls.map((call) => call.url)).not.toContain('https://api.github.com/enterprises/override-ent/copilot/billing/seats');
    expect(report.billingSourceScope).toBe('enterprise');
    expect(report.users[0].login).toBe('org-seat-user');
    expect(report.summary.totalPremiumRequests).toBe(13);
  });

  it('discovers an organization parent enterprise before live premium request lookups', async () => {
    const fetchMock = vi.fn(async (url: string, init?: { params?: Record<string, string>; body?: { variables?: { org?: string } } }) => {
      if (url === 'https://api.github.com/orgs/test-org') {
        return { login: 'test-org', enterprise: null };
      }

      if (url === 'https://api.github.com/graphql') {
        expect(init?.body?.variables?.org).toBe('test-org');
        return {
          data: {
            viewer: {
              enterprises: {
                nodes: [
                  { slug: 'other-enterprise', organizations: { nodes: [] } },
                  { slug: 'parent-enterprise', organizations: { nodes: [{ login: 'test-org' }] } },
                ],
              },
            },
          },
        };
      }

      if (url.includes('/copilot/billing/seats')) {
        expect(url).toBe('https://api.github.com/orgs/test-org/copilot/billing/seats');
        return { seats: [{ assignee: { id: 1, login: 'octocat' } }] };
      }

      expect(url).toBe('https://api.github.com/enterprises/parent-enterprise/settings/billing/premium_request/usage');
  expect(init?.params).toMatchObject({ user: 'octocat', year: '2026', month: '5' });
  expect(init?.params?.organization).toBeUndefined();
      return {
        usageItems: [
          {
            model: 'gpt-4.1',
            grossQuantity: 11,
            discountQuantity: 0,
            netQuantity: 11,
            grossAmount: 0,
            netAmount: 0,
          },
        ],
      };
    });
    vi.stubGlobal('$fetch', fetchMock);

    const report = await fetchBillingUsageReport(
      new Options({ scope: 'organization', githubOrg: 'test-org', since: '2026-05-01', until: '2026-05-31' }),
      new Headers({ Authorization: 'Bearer test-token' }),
      { viewMode: 'premium_request' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(report.billingSourceScope).toBe('enterprise');
    expect(report.billingEnterpriseSlug).toBe('parent-enterprise');
    expect(report.users[0].login).toBe('octocat');
    expect(report.summary.totalPremiumRequests).toBe(11);
  });

  it('keeps standalone organization premium request lookups on organization billing', async () => {
    const fetchMock = vi.fn(async (url: string, init?: { params?: Record<string, string>; body?: { variables?: { org?: string } } }) => {
      if (url === 'https://api.github.com/orgs/standalone-org') {
        return { login: 'standalone-org', enterprise: null };
      }

      if (url === 'https://api.github.com/graphql') {
        expect(init?.body?.variables?.org).toBe('standalone-org');
        return {
          data: {
            viewer: {
              enterprises: {
                nodes: [
                  { slug: 'parent-enterprise', organizations: { nodes: [{ login: 'different-org' }] } },
                ],
              },
            },
          },
        };
      }

      if (url.includes('/copilot/billing/seats')) {
        expect(url).toBe('https://api.github.com/orgs/standalone-org/copilot/billing/seats');
        return { seats: [{ assignee: { id: 1, login: 'mona' } }] };
      }

      expect(url).toBe('https://api.github.com/organizations/standalone-org/settings/billing/premium_request/usage');
      expect(init?.params).toMatchObject({ user: 'mona', year: '2026', month: '5' });
      expect(init?.params?.organization).toBeUndefined();
      return {
        usageItems: [
          {
            model: 'gpt-4.1',
            grossQuantity: 3,
            discountQuantity: 0,
            netQuantity: 3,
            grossAmount: 0,
            netAmount: 0,
          },
        ],
      };
    });
    vi.stubGlobal('$fetch', fetchMock);

    const report = await fetchBillingUsageReport(
      new Options({ scope: 'organization', githubOrg: 'standalone-org', since: '2026-05-01', until: '2026-05-31' }),
      new Headers({ Authorization: 'Bearer test-token' }),
      { viewMode: 'premium_request' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(report.billingSourceScope).toBe('organization');
    expect(report.billingEnterpriseSlug).toBeUndefined();
    expect(report.users[0].login).toBe('mona');
    expect(report.summary.totalPremiumRequests).toBe(3);
  });

  it('marks premium request aggregate records as partial when user identifiers are missing', () => {
    const report = normalizePremiumRequestUsage(
      new Options({ scope: 'enterprise', githubEnt: 'test-enterprise-lc-april' }),
      [
        {
          product: 'copilot',
          sku: 'copilot_enterprise',
          model: 'gpt-4.1',
          unitType: 'requests',
          grossQuantity: 15,
          discountQuantity: 0,
          netQuantity: 15,
          grossAmount: 0,
          netAmount: 0,
        },
      ],
      '2026-05-01',
      '2026-05-07',
      {},
      false,
    );

    expect(report.dataState).toBe('partial');
    expect(report.users[0].login).toBe('unknown-user');
    expect(report.messages[0]).toContain('aggregate records without user identifiers');
  });

  it('keeps all premium request users sorted by usage descending', () => {
    const usage = Array.from({ length: 12 }, (_, index) => ({
      product: 'copilot',
      sku: 'copilot_enterprise',
      model: 'gpt-4.1',
      unitType: 'requests',
      user: { id: index + 1, login: `user-${index + 1}` },
      grossQuantity: index + 1,
      discountQuantity: 0,
      netQuantity: index + 1,
      grossAmount: 0,
      netAmount: 0,
    }));

    const report = normalizePremiumRequestUsage(
      new Options({ scope: 'enterprise', githubEnt: 'test-enterprise-lc-april' }),
      usage,
      '2026-05-01',
      '2026-05-07',
      {},
      false,
    );

    expect(report.users).toHaveLength(12);
    expect(report.users[0].login).toBe('user-12');
    expect(report.users[11].login).toBe('user-1');
  });

  it('loads detailed and aggregate-only token usage mock data', () => {
    const detailed = require('../public/mock-data/billing-usage-token-usage.json') as RawBillingUsageResponse;
    const aggregateOnly = require('../public/mock-data/billing-usage-token-usage-aggregate-only.json') as RawBillingUsageSummaryResponse;

    expect(detailed.usage.some((item) => item.unitType === 'input_tokens')).toBe(true);
    expect(detailed.usage.some((item) => item.unitType === 'output_tokens')).toBe(true);
    expect(detailed.usage.some((item) => item.unitType === 'cached_tokens')).toBe(true);
    expect(detailed.usage.some((item) => item.unitType === 'cache_write_tokens')).toBe(true);
    expect(detailed.usage.every((item) => normalizeRawUserRef(item.user)?.login)).toBe(true);
    expect(aggregateOnly.usage.every((item) => item.product === 'copilot')).toBe(true);
    expect(aggregateOnly.usage.every((item) => item.quantity !== undefined)).toBe(true);
  });

  it('loads team membership mock scenarios', () => {
    const teams = require('../public/mock-data/billing-usage-team-members.json') as {
      organizationTeam: { members: unknown[] };
      enterpriseTeam: { memberships: Array<{ user: unknown }> };
      enterpriseOrganizationOverrideTeam: { members: unknown[]; organization: string };
    };

    expect(teams.organizationTeam.members).toHaveLength(2);
    expect(normalizeRawUserRef(teams.enterpriseTeam.memberships[0].user)?.login).toBe('enterprise-admin');
    expect(teams.enterpriseOrganizationOverrideTeam.organization).toBe('platform-org');
  });

  it('resolves premium usage timeframes to natural billing periods', () => {
    const options = new Options({ scope: 'enterprise', githubEnt: 'mocked-ent' });
    const now = new Date(Date.UTC(2026, 4, 7));

    expect(resolveBillingUsagePeriod(options, 'current_month', now)).toEqual({ start: '2026-05-01', end: '2026-05-31', year: 2026, month: 5 });
    expect(resolveBillingUsagePeriod(options, 'last_month', now)).toEqual({ start: '2026-04-01', end: '2026-04-30', year: 2026, month: 4 });
    expect(resolveBillingUsagePeriod(options, 'this_year', now)).toEqual({ start: '2026-01-01', end: '2026-12-31', year: 2026 });
    expect(resolveBillingUsagePeriod(options, 'last_year', now)).toEqual({ start: '2025-01-01', end: '2025-12-31', year: 2025 });
  });

  it('normalizes premium request usage into user and model rows', () => {
    const org = require('../public/mock-data/billing-usage-organization-premium-request.json') as RawPremiumRequestUsageResponse;
    const report = normalizePremiumRequestUsage(
      new Options({ scope: 'organization', githubOrg: 'mocked-org', isDataMocked: true }),
      org.usage,
      '2026-04-03',
      '2026-04-30',
      {},
      true,
    );

    expect(report.dataState).toBe('complete');
    expect(report.summary.totalUsers).toBe(3);
    expect(report.summary.totalPremiumRequests).toBe(123);
    expect(report.users[0].models.length).toBeGreaterThan(0);
    expect(report.modelOptions.map((item) => item.modelKey)).toContain('gpt-4-1');
  });

  it('normalizes token usage into per-user token categories', () => {
    const raw = require('../public/mock-data/billing-usage-token-usage.json') as RawBillingUsageResponse;
    const report = normalizeTokenUsage(
      new Options({ scope: 'organization', githubOrg: 'mocked-org', isDataMocked: true }),
      raw.usage,
      '2026-04-03',
      '2026-04-30',
      {},
      true,
    );

    expect(report.dataState).toBe('complete');
    expect(report.summary.totalTokens).toBe(2615000);
    expect(report.summary.totalInputTokens).toBe(1790000);
    expect(report.summary.totalOutputTokens).toBe(420000);
    expect(report.summary.totalCachedTokens).toBe(310000);
    expect(report.summary.totalCacheWriteTokens).toBe(95000);
  });

  it('post-filters normalized billing users by team members using login or user ID', () => {
    const org = require('../public/mock-data/billing-usage-organization-premium-request.json') as RawPremiumRequestUsageResponse;
    const report = normalizePremiumRequestUsage(
      new Options({ scope: 'organization', githubOrg: 'mocked-org', githubTeam: 'platform-engineering', isDataMocked: true }),
      org.usage,
      '2026-04-03',
      '2026-04-30',
      {},
      true,
    );
    const filtered = applyTeamMemberFilter(report, [{ login: 'octocat' }, { id: 102 }]);

    expect(filtered.users.map((user) => user.login)).toEqual(['octocat', 'hubber']);
    expect(filtered.summary.totalPremiumRequests).toBe(99);
    expect(filtered.resolvedMemberCount).toBe(2);
  });

  it('post-filters enterprise team membership responses with nested user shape', () => {
    const org = require('../public/mock-data/billing-usage-organization-premium-request.json') as RawPremiumRequestUsageResponse;
    const report = normalizePremiumRequestUsage(
      new Options({ scope: 'enterprise', githubEnt: 'mocked-ent', githubTeam: 'enterprise-platform' }),
      org.usage,
      '2026-04-03',
      '2026-04-30',
      {},
      false,
    );
    const members = [{ user: { id: 103, login: 'mona' } }];
    const filtered = applyTeamMemberFilter(report, members);

    expect(normalizeTeamMemberRefs(members)).toEqual([{ id: 103, login: 'mona' }]);
    expect(filtered.users).toHaveLength(1);
    expect(filtered.users[0].login).toBe('mona');
    expect(filtered.summary.totalPremiumRequests).toBe(24);
    expect(filtered.teamKind).toBe('enterprise_team');
  });

  it('narrows premium request candidate users before per-user usage calls', async () => {
    const fetchCalls: Array<{ url: string; params?: Record<string, string> }> = [];
    vi.stubGlobal('$fetch', async (url: string, request?: { params?: Record<string, string> }) => {
      fetchCalls.push({ url, params: request?.params });

      if (url.includes('/teams/platform/memberships')) {
        return [{ user: { id: 202, login: 'team-user' } }];
      }

      if (url.includes('/copilot/billing/seats')) {
        return {
          total_seats: 3,
          seats: [
            { assignee: { id: 201, login: 'outside-user' } },
            { assignee: { id: 202, login: 'team-user' } },
            { assignee: { id: 203, login: 'another-outside-user' } },
          ],
        };
      }

      if (url.includes('/settings/billing/premium_request/usage')) {
        expect(request?.params?.user).toBe('team-user');
        return {
          usage: [
            {
              product: 'copilot',
              sku: 'copilot_enterprise',
              model: 'gpt-4.1',
              unitType: 'requests',
              grossQuantity: 7,
              discountQuantity: 1,
              netQuantity: 6,
              grossAmount: 0,
              netAmount: 0,
            },
          ],
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const report = await fetchBillingUsageReport(
      new Options({ scope: 'enterprise', githubEnt: 'mocked-ent', githubTeam: 'platform' }),
      new Headers({ Authorization: 'Bearer test-token' }),
      { viewMode: 'premium_request' },
    );
    const premiumUsageCalls = fetchCalls.filter((call) => call.url.includes('/settings/billing/premium_request/usage'));

    expect(filterPremiumRequestCandidateUsers([
      { id: 201, login: 'outside-user' },
      { id: 202, login: 'team-user' },
    ], [{ user: { id: 202, login: 'team-user' } }])).toEqual([{ id: 202, login: 'team-user' }]);
    expect(premiumUsageCalls).toHaveLength(1);
    expect(premiumUsageCalls[0].params?.user).toBe('team-user');
    expect(report.users).toHaveLength(1);
    expect(report.users[0].login).toBe('team-user');
    expect(report.summary.totalPremiumRequests).toBe(7);
    expect(report.resolvedMemberCount).toBe(1);
  });

  it('reuses cached premium request team inputs for repeated report requests', async () => {
    const fetchCalls: string[] = [];
    vi.stubGlobal('$fetch', async (url: string, request?: { params?: Record<string, string> }) => {
      fetchCalls.push(url);

      if (url.includes('/teams/cache-team/memberships')) {
        return [{ user: { id: 302, login: 'cached-user' } }];
      }

      if (url.includes('/copilot/billing/seats')) {
        return {
          seats: [
            { assignee: { id: 301, login: 'outside-user' } },
            { assignee: { id: 302, login: 'cached-user' } },
          ],
        };
      }

      if (url.includes('/settings/billing/premium_request/usage')) {
        expect(request?.params?.user).toBe('cached-user');
        return {
          usage: [
            {
              model: 'gpt-4.1',
              unitType: 'requests',
              grossQuantity: 9,
              discountQuantity: 0,
              netQuantity: 9,
              grossAmount: 0,
              netAmount: 0,
            },
          ],
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const options = new Options({ scope: 'enterprise', githubEnt: 'cache-ent', githubTeam: 'cache-team' });
    const headers = new Headers({ Authorization: 'Bearer cache-token' });

    const first = await fetchBillingUsageReport(options, headers, { viewMode: 'premium_request' });
    const second = await fetchBillingUsageReport(options, headers, { viewMode: 'premium_request' });

    expect(first.summary.totalPremiumRequests).toBe(9);
    expect(second.summary.totalPremiumRequests).toBe(9);
    expect(fetchCalls.filter((url) => url.includes('/teams/cache-team/memberships'))).toHaveLength(1);
    expect(fetchCalls.filter((url) => url.includes('/copilot/billing/seats'))).toHaveLength(1);
    expect(fetchCalls.filter((url) => url.includes('/settings/billing/premium_request/usage'))).toHaveLength(1);
  });
});

describe('Billing usage raw parser helpers', () => {
  it('safely reads optional strings and numbers', () => {
    expect(readString(' octocat ')).toBe('octocat');
    expect(readString('   ')).toBeUndefined();
    expect(readNumber('42.5')).toBe(42.5);
    expect(readNumber('not-a-number')).toBeUndefined();
  });

  it('normalizes user references from object or string values', () => {
    expect(normalizeRawUserRef('octocat')).toEqual({ login: 'octocat' });
    expect(normalizeRawUserRef({ id: '101', login: 'octocat', avatar_url: 'https://example.test/avatar.png' })).toEqual({
      id: 101,
      login: 'octocat',
      avatarUrl: 'https://example.test/avatar.png',
    });
    expect(normalizeRawUserRef(null)).toBeUndefined();
  });

  it('normalizes model keys and detects optional quantity and amount fields', () => {
    expect(readModelKey('Claude Sonnet 4.5')).toBe('claude-sonnet-4-5');
    expect(hasTokenQuantityFields({ quantity: '1250000' })).toBe(true);
    expect(hasTokenQuantityFields({ quantity: null })).toBe(false);
    expect(hasAmountFields({ netAmount: 10.25 })).toBe(true);
    expect(hasAmountFields({ netAmount: 'n/a' })).toBe(false);
  });
});