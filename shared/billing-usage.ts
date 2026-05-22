export type BillingUsageScope = 'organization' | 'enterprise';

export type BillingUsageViewMode = 'premium_request' | 'token_usage';

export type BillingUsageDataState = 'complete' | 'partial' | 'unavailable' | 'permission_denied';

export type BillingUsageSource = 'github_billing_analytics' | 'github_billing_report' | 'mock' | 'unavailable';

export type BillingUsageSourceApi = 'premium_request_usage' | 'billing_usage' | 'billing_usage_summary' | 'mock';

export type BillingUsageTimeframe = 'current_month' | 'last_month' | 'this_year' | 'last_year';

export type BillingUsageTeamKind = 'organization_team' | 'enterprise_team';

export type BillingUsageTeamFilterMethod = 'current_membership_post_filter' | 'upstream_team_filter' | 'none';

export interface BillingUsageTeamFilterMetadata {
  teamSlug?: string;
  teamKind?: BillingUsageTeamKind;
  teamFilterMethod?: BillingUsageTeamFilterMethod;
  teamFilterWarning?: string;
  resolvedMemberCount?: number;
}

export interface ModelPricingSnapshot {
  modelKey: string;
  effectiveDate: string;
  unit: 'per_1m_tokens';
  inputUsdPer1MTokens?: number;
  outputUsdPer1MTokens?: number;
  cachedInputUsdPer1MTokens?: number;
  cacheWriteUsdPer1MTokens?: number;
  sourceUrl?: string;
}

export interface BillingUsageSummary {
  totalUsers: number;
  totalPremiumRequests?: number;
  totalIncludedRequests?: number;
  totalBilledRequests?: number;
  totalTokens?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCachedTokens?: number;
  totalCacheWriteTokens?: number;
  grossAmountUsd?: number;
  billedAmountUsd?: number;
  estimatedCostUsd?: number;
}

export interface BillingUsageModelDetail {
  model: string;
  modelKey: string;
  premiumRequests?: number;
  includedRequests?: number;
  billedRequests?: number;
  grossAmountUsd?: number;
  billedAmountUsd?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  estimatedCostUsd?: number;
  pricing?: ModelPricingSnapshot;
}

export interface BillingUsageUser {
  login: string;
  userId?: number;
  avatarUrl?: string;
  organizationLogin?: string;
  teamSlugs?: string[];
  premiumRequests?: number;
  includedRequests?: number;
  billedRequests?: number;
  grossAmountUsd?: number;
  billedAmountUsd?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  estimatedCostUsd?: number;
  models: BillingUsageModelDetail[];
}

export interface BillingUsageModelOption {
  model: string;
  modelKey: string;
}

export interface BillingUsageReport extends BillingUsageTeamFilterMetadata {
  scope: BillingUsageScope;
  identifier: string;
  billingSourceScope?: BillingUsageScope;
  billingEnterpriseSlug?: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  source: BillingUsageSource;
  sourceApi?: BillingUsageSourceApi;
  viewModes: BillingUsageViewMode[];
  summary: BillingUsageSummary;
  users: BillingUsageUser[];
  modelOptions: BillingUsageModelOption[];
  dataState: BillingUsageDataState;
  messages: string[];
}