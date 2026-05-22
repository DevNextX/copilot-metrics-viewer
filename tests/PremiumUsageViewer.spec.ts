import { describe, expect, it } from 'vitest'
import PremiumUsageViewer from '../app/components/PremiumUsageViewer.vue'
import type { BillingUsageReport } from '../shared/billing-usage'

const premiumReport: BillingUsageReport = {
  scope: 'organization',
  identifier: 'mocked-org',
  periodStart: '2026-05-01',
  periodEnd: '2026-05-31',
  generatedAt: '2026-05-08T00:00:00.000Z',
  source: 'mock',
  sourceApi: 'mock',
  viewModes: ['premium_request'],
  summary: { totalUsers: 2, totalPremiumRequests: 52 },
  users: [
    {
      login: 'octocat',
      premiumRequests: 40,
      includedRequests: 5,
      billedRequests: 35,
      models: [{ model: 'gpt-4.1', modelKey: 'gpt-4-1', premiumRequests: 40 }],
    },
    {
      login: 'mona',
      premiumRequests: 12,
      includedRequests: 0,
      billedRequests: 12,
      models: [{ model: 'claude-sonnet-4.5', modelKey: 'claude-sonnet-4-5', premiumRequests: 12 }],
    },
  ],
  modelOptions: [
    { model: 'gpt-4.1', modelKey: 'gpt-4-1' },
    { model: 'claude-sonnet-4.5', modelKey: 'claude-sonnet-4-5' },
  ],
  dataState: 'complete',
  messages: [],
}

const tokenReport: BillingUsageReport = {
  ...premiumReport,
  viewModes: ['token_usage'],
  summary: { totalUsers: 1, totalTokens: 1200 },
  users: [
    {
      login: 'mona',
      totalTokens: 1200,
      inputTokens: 800,
      outputTokens: 400,
      models: [{ model: 'gpt-4.1', modelKey: 'gpt-4-1', totalTokens: 1200 }],
    },
  ],
  messages: ['Token usage is aggregate-only for this response.'],
  dataState: 'partial',
}

function createState(overrides: Record<string, unknown> = {}) {
  const component = PremiumUsageViewer as unknown as {
    data: () => Record<string, unknown>
    computed: Record<string, (this: Record<string, unknown>) => unknown>
    methods: Record<string, (this: Record<string, unknown>, ...args: unknown[]) => unknown>
  }
  const state = {
    ...component.data(),
    queryParams: { scope: 'organization', githubOrg: 'mocked-org', isDataMocked: 'true' },
    dateRangeDescription: 'Current month',
    dateRange: { since: '2026-05-01', until: '2026-05-31' },
    normalizeTeamSelection: component.methods.normalizeTeamSelection,
    ...overrides,
  }
  return { component, state }
}

describe('PremiumUsageViewer component logic', () => {
  it('filters Premium Request rows by model and search text', () => {
    const { component, state } = createState({ rawReport: premiumReport, selectedModel: 'gpt-4-1', search: 'octo' })

    state.modelFilteredUsers = component.computed.modelFilteredUsers.call(state)
    const filteredUsers = component.computed.filteredUsers.call(state) as Array<{ login: string; premiumRequests?: number }>

    expect(component.computed.tableTitle.call(state)).toBe('Premium Request Usage by User')
    expect(filteredUsers).toHaveLength(1)
    expect(filteredUsers[0]).toMatchObject({ login: 'octocat', premiumRequests: 40 })
  })

  it('builds Token Usage request params and exposes partial messages', () => {
    const { component, state } = createState({ rawReport: tokenReport, viewMode: 'token_usage', selectedTeam: 'platform', selectedTimeframe: 'last_month' })

    const params = component.methods.buildReportParams.call(state) as URLSearchParams
    const messages = component.computed.reportMessages.call(state) as string[]

    expect(component.computed.tableTitle.call(state)).toBe('Token Usage by User')
    expect(params.get('viewMode')).toBe('token_usage')
    expect(params.get('timeframe')).toBe('last_month')
    expect(params.get('githubTeam')).toBe('platform')
    expect(messages).toContain('Token usage is aggregate-only for this response.')
  })
})