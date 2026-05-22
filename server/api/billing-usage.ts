import { Options, normalizeGitHubTeamSlug } from '@/model/Options';
import type { BillingUsageSourceApi, BillingUsageViewMode } from '../../shared/billing-usage';
import { applyTeamMemberFilter, fetchBillingUsageReport } from '../services/github-copilot-billing-usage-api';
import { fetchAllTeamMembers } from '../utils/team-members';

const VALID_VIEW_MODES = new Set(['premium_request', 'token_usage']);
const VALID_SOURCE_APIS = new Set(['premium_request_usage', 'billing_usage', 'billing_usage_summary', 'mock']);
const VALID_TIMEFRAMES = new Set(['current_month', 'last_month', 'this_year', 'last_year']);

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event);
    const options = Options.fromQuery(query);
    const config = useRuntimeConfig();

    if (!options.scope && config.public.scope) options.scope = config.public.scope as 'organization' | 'enterprise';
    if (!options.githubOrg && config.public.githubOrg && options.scope !== 'enterprise') options.githubOrg = config.public.githubOrg;
    if (!options.githubEnt && config.public.githubEnt) options.githubEnt = config.public.githubEnt;
    if (!options.githubTeam && config.public.githubTeam) options.githubTeam = normalizeGitHubTeamSlug(config.public.githubTeam);
    options.githubTeam = normalizeGitHubTeamSlug(options.githubTeam);
    if (!options.isDataMocked && (config.public.isDataMocked === true || config.public.isDataMocked === 'true')) options.isDataMocked = true;

    validateBillingUsageQuery(options, query);

    if (!options.isDataMocked && !event.context.headers?.has('Authorization')) {
      throw createError({ statusCode: 401, statusMessage: 'No Authentication provided' });
    }

    const viewMode = (query.viewMode as BillingUsageViewMode | undefined) ?? 'premium_request';
    const report = await fetchBillingUsageReport(options, event.context.headers, {
      viewMode,
      model: query.model as string | undefined,
      user: query.user as string | undefined,
      timeframe: query.timeframe as string | undefined,
      sourceApi: query.sourceApi as BillingUsageSourceApi | undefined,
    });

    if (!options.isDataMocked && options.githubTeam && viewMode !== 'premium_request') {
      const members = await fetchAllTeamMembers(options, event.context.headers);
      return applyTeamMemberFilter(report, members);
    }

    return report;
  } catch (error: unknown) {
    const statusCode = error && typeof error === 'object' && 'statusCode' in error
      ? (error as { statusCode?: number }).statusCode ?? 500
      : 500;
    const message = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode, statusMessage: `Error fetching billing usage data: ${message}` });
  }
});

function validateBillingUsageQuery(options: Options, query: ReturnType<typeof getQuery>): void {
  const viewMode = query.viewMode as string | undefined;
  if (viewMode && !VALID_VIEW_MODES.has(viewMode)) {
    throw createError({ statusCode: 400, statusMessage: `Unsupported billing usage viewMode: ${viewMode}` });
  }

  const sourceApi = query.sourceApi as string | undefined;
  if (sourceApi && !VALID_SOURCE_APIS.has(sourceApi)) {
    throw createError({ statusCode: 400, statusMessage: `Unsupported billing usage sourceApi: ${sourceApi}` });
  }

  const timeframe = query.timeframe as string | undefined;
  if (timeframe && !VALID_TIMEFRAMES.has(timeframe)) {
    throw createError({ statusCode: 400, statusMessage: `Unsupported billing usage timeframe: ${timeframe}` });
  }

  if (options.scope === 'enterprise' && !options.githubEnt) {
    throw createError({ statusCode: 422, statusMessage: 'githubEnt is required for enterprise billing usage' });
  }

  if ((options.scope === 'organization' || !options.scope) && !options.githubOrg) {
    throw createError({ statusCode: 422, statusMessage: 'githubOrg is required for organization billing usage' });
  }

  if (options.since && options.until && new Date(options.since) > new Date(options.until)) {
    throw createError({ statusCode: 422, statusMessage: 'since must be before until' });
  }
}