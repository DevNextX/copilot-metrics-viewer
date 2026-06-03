# Design: Premium Request Analytics / Token Usage

## 1. Overview

- Reference: [docs/requirements/req-premium-request-token-usage.md](../requirements/req-premium-request-token-usage.md)
- GitHub Issue: https://github.com/github-copilot-resources/copilot-metrics-viewer/issues/362

This design adds a dedicated Premium Request Analytics / Token Usage reporting capability to Copilot Metrics Viewer. The feature mirrors the current GitHub.com billing pattern where usage is shown as a user-level table and each user row can be expanded to show model-level details. During the transition period, the report supports both Premium Request view and Token Usage view. After June 1, 2026, the same table and expandable model detail pattern becomes token-first, with request metrics hidden or de-emphasized.

The feature should be treated as a billing usage reporting domain, separate from the existing Copilot Usage Metrics API domain. Existing `user metrics` and `models` tabs expose Copilot activity metrics such as interactions, code generations, LOC, features, and model feature usage. Premium request and token billing data has different semantics, permission requirements, and expected API sources, so it should have its own data contracts and service layer.

## 2. Architecture Changes

### Backend

- Add a new server API endpoint for billing usage analytics:
  - `GET /api/billing-usage`
- Add a dedicated service module:
  - `server/services/github-copilot-billing-usage-api.ts`
- Add billing-specific TypeScript models under `shared/` or `app/types/` so frontend and backend can share response contracts.
- Reuse existing `Options` scope parsing and route conventions for organization, enterprise, and team scope.
- Use GitHub Billing Usage REST APIs as the upstream billing data source, with API support treated as capability-driven rather than assumed complete:
  - Premium request usage: `GET /enterprises/{enterprise}/settings/billing/premium_request/usage` and `GET /organizations/{org}/settings/billing/premium_request/usage` with `X-GitHub-Api-Version: 2022-11-28`.
  - Current validation has not identified a single organization-level or enterprise-level API call that returns every user's premium request usage in one response. The reliable test path is to query a known user with `user={user-login}`, for example `GET /enterprises/{enterprise}/settings/billing/premium_request/usage?user={user-login}`.
  - GitHub enterprise premium request usage rejects `user` and `organization` when both filters are sent together. For enterprise-owned organization reports, the backend must narrow the candidate users with organization teams/seats, then call the enterprise premium request endpoint per user without also sending `organization`.
  - Phase 1 must therefore avoid assuming that the upstream premium request endpoint can enumerate all users. User-level reports require either a separate authorized user enumeration source plus per-user premium request calls, or a degraded aggregate/unknown-user response when no user dimension is returned.
  - Token usage: use the general enhanced billing endpoints, `GET /enterprises/{enterprise}/settings/billing/usage`, `GET /enterprises/{enterprise}/settings/billing/usage/summary`, `GET /organizations/{org}/settings/billing/usage`, and `GET /organizations/{org}/settings/billing/usage/summary`, filtering Copilot-related items by `product`, `sku`, and token-like `unitType` values when GitHub reports token/AI Credits usage through those responses.
- Treat token usage source support as capability-driven. Current public docs expose general billing usage and usage summary endpoints, but do not show a dedicated Copilot token-usage endpoint or a sample Copilot token response shape. The implementation should isolate this behind source adapters so a future GitHub-provided token-specific endpoint can replace the general billing adapter without changing the UI contract.
- Reuse existing team member resolution from `server/api/seats.ts` for team filtering because Billing Usage APIs return account-level enterprise/organization usage and do not support team as a query parameter.
- Cache expensive live billing inputs in memory with a short TTL and authorization-scoped cache keys:
  - parent enterprise discovery for organization scopes
  - team membership pages
  - Copilot seats
  - per-user Premium Request usage for a billing period
  - in-flight duplicate requests should share the same promise so concurrent refreshes do not fan out to GitHub.
- Keep historical storage optional for phase 1. If billing usage data is only available from live GitHub APIs or downloadable reports, phase 1 should fetch on demand and clearly report data/permission failures.
- Keep cost estimation as a future-compatible field in the response model, but do not make estimated cost required until pricing source/version management is implemented.

### Frontend

- Add a new tab in `app/components/MainComponent.vue`:
  - `premium usage`
- Add a new component:
  - `app/components/PremiumUsageViewer.vue`
- The component owns the billing-specific view state:
  - display mode: `premium_request` or `token_usage`
  - team filter selected from `/api/teams`
  - billing timeframe: `current_month`, `last_month`, `this_year`, or `last_year`
  - model filter
  - search/filter text
  - expanded user rows
- The component should render a user-level table with expandable model rows:
  - User row: aggregate usage for the user.
  - Expanded row: per-model details for that user.
- Reuse the existing app shell, route-derived scope, date range description, error handling style, and Vuetify table patterns.
- Render Team and Timeframe as visible dropdowns in the Premium Usage toolbar. Team defaults to all teams. Timeframe defaults to current month because billing quotas are calendar-month based.
- Token Usage view should preserve the same table structure as Premium Request view and replace request columns with token columns.

### Existing Integration Points

- `app/components/MainComponent.vue`
  - Add the `premium usage` tab to `tabItems`.
  - Add a `PremiumUsageViewer` window item.
  - Pass route-derived query parameters and date range.
- `app/model/Options.ts`
  - Reuse existing `scope`, `githubOrg`, `githubEnt`, `githubTeam`, `since`, `until`, and `isDataMocked` serialization.
  - No new route model is required for phase 1.
  - Reuse `getTeamsApiUrl()` and `getTeamMembersApiUrl()` behavior for team filters:
    - Organization scope uses organization teams: `/orgs/{org}/teams` and `/orgs/{org}/teams/{team_slug}/members`.
    - Enterprise scope without `githubOrg` uses enterprise teams: `/enterprises/{enterprise}/teams` and `/enterprises/{enterprise}/teams/{team_slug}/memberships` with API version `2026-03-10`.
    - Enterprise scope with an organization override uses organization teams inside that enterprise.
- `server/api/user-metrics.ts`
  - Reuse the team filtering pattern conceptually, but do not mix billing usage data into `UserTotals`.
- `server/services/github-copilot-usage-api.ts`
  - Keep existing usage metrics types unchanged.
  - New billing usage service should not overload `UserTotals`, because premium request/token billing data is not the same as Copilot activity metrics.

## 3. Data Model

### Domain Model

The backend response should normalize GitHub billing usage data into an application-owned model. This allows the UI to stay stable even if GitHub changes report delivery between premium request and token billing periods.

**Entity**: `BillingUsageReport`

- `scope`: `organization | enterprise`
- `identifier`: organization login or enterprise slug
- `teamSlug`: optional team filter
- `teamKind`: optional `organization_team | enterprise_team`
- `teamFilterMethod`: optional `current_membership_post_filter | upstream_team_filter | none`
- `teamFilterWarning`: optional warning shown when team results are based on current team membership rather than historical billing attribution
- `billingSourceScope`: optional `organization | enterprise` indicating where the billing data was actually fetched from
- `billingEnterpriseSlug`: optional resolved enterprise slug when an organization report uses enterprise billing
- `periodStart`: ISO date
- `periodEnd`: ISO date
- `generatedAt`: timestamp when the app generated the normalized report
- `source`: `github_billing_analytics | github_billing_report | mock | unavailable`
- `sourceApi`: optional upstream API identifier, for example `premium_request_usage`, `ai_credit_usage`, `billing_usage`, or `billing_usage_summary`
- `viewModes`: supported display modes for this response
- `summary`: `BillingUsageSummary`
- `users`: `BillingUsageUser[]`
- `modelOptions`: available models for filtering
- `dataState`: `complete | partial | unavailable | permission_denied`
- `messages`: user-facing diagnostic messages for partial or unavailable data

**Entity**: `BillingUsageSummary`

- `totalUsers`: number
- `totalPremiumRequests`: optional number
- `totalTokens`: optional number
- `totalInputTokens`: optional number
- `totalOutputTokens`: optional number
- `totalCachedTokens`: optional number
- `totalCacheWriteTokens`: optional number
- `estimatedCostUsd`: optional number, future field

**Entity**: `BillingUsageUser`

- `login`: GitHub username
- `userId`: optional GitHub user ID
- `avatarUrl`: optional URL if available
- `teamSlugs`: optional teams used for filtering or display
- `premiumRequests`: optional number
- `includedRequests`: optional number
- `billedRequests`: optional number
- `grossAmountUsd`: optional number
- `billedAmountUsd`: optional number
- `totalTokens`: optional number
- `inputTokens`: optional number
- `outputTokens`: optional number
- `cachedTokens`: optional number
- `cacheWriteTokens`: optional number
- `estimatedCostUsd`: optional number, future field
- `models`: `BillingUsageModelDetail[]`

**Entity**: `BillingUsageModelDetail`

- `model`: display model name
- `modelKey`: normalized model identifier used for filtering
- `premiumRequests`: optional number
- `includedRequests`: optional number
- `billedRequests`: optional number
- `grossAmountUsd`: optional number
- `billedAmountUsd`: optional number
- `totalTokens`: optional number
- `inputTokens`: optional number
- `outputTokens`: optional number
- `cachedTokens`: optional number
- `cacheWriteTokens`: optional number
- `estimatedCostUsd`: optional number, future field
- `pricing`: optional `ModelPricingSnapshot`

**Entity**: `ModelPricingSnapshot` future-compatible field

- `modelKey`: normalized model identifier
- `effectiveDate`: pricing effective date
- `unit`: `per_1m_tokens`
- `inputUsdPer1MTokens`: optional number
- `outputUsdPer1MTokens`: optional number
- `cachedInputUsdPer1MTokens`: optional number
- `cacheWriteUsdPer1MTokens`: optional number
- `sourceUrl`: GitHub model pricing reference URL

### Data Semantics

- Premium requests and tokens must be modeled as separate metric families.
- The UI must not imply a direct conversion between premium requests and tokens.
- Premium Usage time filtering uses natural billing periods rather than the dashboard's rolling activity window. Supported `timeframe` values are `current_month`, `last_month`, `this_year`, and `last_year`.
- Month timeframes map to GitHub billing params `{ year, month }`. Year timeframes map to `{ year }` and omit `month` so the upstream query can return the full calendar year where supported.
- Token totals may be partial if GitHub exposes only some token categories.
- Cost fields must be labeled as estimates unless they come from official billed amount fields.
- Team filtering must disclose whether it is based on current team membership or upstream historical team attribution.

### GitHub Source APIs

The billing data source should be explicit and adapter-based. The app-owned `GET /api/billing-usage` endpoint should not expose raw GitHub response shapes directly.

**AI Credit source**

- Enterprise: `GET /enterprises/{enterprise}/settings/billing/ai_credit/usage`
- Organization: `GET /organizations/{org}/settings/billing/ai_credit/usage`
- `GET /api/billing-usage` defaults to `viewMode=ai_credit` and `sourceApi=ai_credit_usage`.
- AI Credit usage is queried at the billing entity. If an organization is billed through a GitHub Enterprise, the backend uses the enterprise `ai_credit/usage` endpoint and reports `billingSourceScope=enterprise`; standalone organizations use the organization endpoint.
- Current validation confirms aggregate responses can include `sku: Copilot AI Credits` and `unitType: ai-credits`, but they may omit user identifiers. The default AI Credit table therefore enumerates Copilot seat users for the current report boundary, then queries the billing entity with `user={login}` to build user-level rows. Do not combine `organization` and `user` on the enterprise AI Credit endpoint.
- AI Credit records expose `unitType: ai-credits`, `grossQuantity`, `discountQuantity`, `netQuantity`, `grossAmount`, `discountAmount`, and `netAmount`. The UI maps these to AI credits, included credits, additional credits, gross amount, and additional usage.

**Legacy Premium Request source**

- Enterprise: `GET /enterprises/{enterprise}/settings/billing/premium_request/usage`
- Organization: `GET /organizations/{org}/settings/billing/premium_request/usage`
- API version: `2022-11-28`
- Verified test shape: `GET /enterprises/{enterprise}/settings/billing/premium_request/usage?user={user-login}` with `Accept: application/vnd.github+json`, `Authorization: Bearer <token>`, and `X-GitHub-Api-Version: 2022-11-28`.
- Useful filters exposed by GitHub docs include `year`, `month`, `day`, `organization` for enterprise, `user`, `model`, `product`, and `cost_center_id` for enterprise.
- The enterprise endpoint must not receive both `user` and `organization` in the same request. When building per-user reports for an enterprise-owned organization, use `user={login}` only, with org/team scoping enforced by the app's candidate-user set.
- The response is account-level for the enterprise or organization. It can be filtered by user or model, but not by team. Do not assume the unfiltered account-level response contains one row per user; if the response omits user identifiers, normalize it as aggregate/unknown-user data and surface a capability message.
- Premium request records expose request-oriented fields such as `unitType: requests`, `grossQuantity`, `discountQuantity`, `netQuantity`, `grossAmount`, `discountAmount`, and `netAmount`.
- To build the default user-level view before GitHub exposes a bulk user-level premium request endpoint, the backend needs an explicit user candidate list from the current report scope: enterprise seats for enterprise reports, organization seats for organization reports, and organization seats for enterprise + organization override reports. It then calls the premium request endpoint once per candidate user. This should be implemented with concurrency limits, pagination/caching where available, and clear partial-data messages when only a subset of users could be queried. Top N or lazy-loading optimizations are deferred.

**Token Usage source**

- Enterprise detailed usage: `GET /enterprises/{enterprise}/settings/billing/usage`
- Enterprise summary usage: `GET /enterprises/{enterprise}/settings/billing/usage/summary`
- Organization detailed usage: `GET /organizations/{org}/settings/billing/usage`
- Organization summary usage: `GET /organizations/{org}/settings/billing/usage/summary`
- API version: `2022-11-28`
- These endpoints are available through the enhanced billing platform and are intended for metered billing usage reporting across paid GitHub products.
- Current public examples show generic products such as Actions. They do not yet document a Copilot token-specific example response or a dedicated Copilot token usage endpoint, so Phase 1 must not make token-category completeness a hard dependency.
- Phase 1 should therefore implement token usage as a capability-detected adapter over the general billing usage endpoints. The adapter should include Copilot usage items where `product`, `sku`, and `unitType` indicate Copilot token/AI Credits usage, and should return `dataState: partial` or `unavailable` with clear messages when token fields are not present.
- `usage/summary` is useful for aggregated totals by `product`, `sku`, and unit type. `usage` is preferred when user-level, organization-level, repository-level, date-level, or other detail fields are present in the response. If neither endpoint exposes user and model dimensions for Copilot token usage, the UI must not fabricate per-user/per-model token details.

**Source selection rules**

- For Premium Request view, call the premium request usage endpoint for the selected billing source scope.
- For `scope=organization`, first determine whether the organization is standalone or enterprise-owned:
  - If `githubEnt` is provided explicitly, use it as the enterprise billing source.
  - Otherwise, attempt REST organization metadata first, then GraphQL `viewer.enterprises(first: 100) { organizations(query: $org) { nodes { login } } }` to find a visible parent enterprise.
  - If a parent enterprise is found, set `billingSourceScope=enterprise` and `billingEnterpriseSlug=<slug>` in the response. Use organization teams and organization seats to define candidate users, then query enterprise premium request usage per user.
  - If no parent enterprise is found, treat the organization as standalone and use the organization premium request endpoint with `billingSourceScope=organization`.
- For Token Usage view, call the detailed billing usage endpoint first when user/model details are required, then fall back to usage summary only for aggregate totals.
- `scope=enterprise` without `githubOrg` is enterprise-wide billing usage. Team filters in this mode refer to Enterprise Teams, and billing data comes from enterprise billing endpoints.
- `scope=organization` is organization billing usage. Team filters in this mode refer to Organization Teams, and billing data comes from organization billing endpoints.
- `scope=enterprise` with `githubOrg` is an organization override inside an enterprise context by default, not an enterprise-wide report. Team filters in this mode refer to Organization Teams in `githubOrg`. Premium Request view uses the enterprise premium request endpoint as the billing source, but per-user calls omit `organization` when `user` is present; the organization/team boundary is enforced by candidate-user selection. Token Usage view should use organization enhanced billing endpoints when available. A future explicit `billingSourceScope=enterprise` option can support enterprise-wide billing data post-filtered by an org team, but phase 1 should not silently mix those semantics.
- Keep adapters separate for premium request, detailed billing usage, and billing usage summary so schema changes or new GitHub endpoints are localized.

### Team Filtering Architecture

GitHub Billing Usage APIs should be treated as enterprise-level or organization-level sources. They do not currently expose `team` or `team_slug` query parameters. Team filtering must therefore be implemented by resolving team membership and post-filtering user-level billing rows inside this application.

The filter boundary is the user candidate set, not the raw Billing Usage API. For Premium Request live reports that are built by enumerating Copilot seat users and calling `premium_request/usage?user={login}`, team filtering must resolve members before the per-user premium request loop. This reduces the candidate set from all seats to only current team members, lowers API volume, and avoids querying usage for users outside the requested team. If the request also includes an explicit diagnostic `user` filter, the backend should intersect that login with the resolved team members before calling the upstream premium request endpoint.

For enterprise-owned organization reports, team membership and Copilot seats remain organization-scoped even when billing comes from the parent enterprise. This preserves Organization Team semantics while still querying the correct enterprise billing source for Premium Request data.

For Token Usage reports, the preferred path is to fetch detailed billing usage records once for the selected billing source scope, normalize records that contain user identifiers, then post-filter by the resolved team member set. If the upstream token source later supports efficient per-user or user-list filtering, the same candidate-set principle applies. If token usage is aggregate-only and has no user-level records, team filtering can only return aggregate/partial state and must not create synthetic team member rows or split totals across users.

Team kind is derived from route/query context:

- `scope=enterprise` and no `githubOrg`: `githubTeam` is an Enterprise Team.
- `scope=organization`: `githubTeam` is an Organization Team.
- `scope=enterprise` with `githubOrg`: `githubTeam` is an Organization Team in `githubOrg`; the report is an organization override inside the enterprise context unless a future explicit enterprise-wide billing source option is added.

Team filter behavior:

- Organization scope:
  - Resolve teams with `/orgs/{org}/teams`.
  - Resolve members with `/orgs/{org}/teams/{team_slug}/members`.
  - Filter normalized billing rows where `BillingUsageUser.login` or `userId` matches the resolved member list.
- Enterprise scope, enterprise team:
  - Resolve teams with `/enterprises/{enterprise}/teams`.
  - Resolve members with `/enterprises/{enterprise}/teams/{team_slug}/memberships`.
  - Use `X-GitHub-Api-Version: 2026-03-10` for enterprise team APIs.
  - Normalize membership responses to `{ login, id }` before filtering.
- Enterprise scope, organization team inside a selected organization:
  - If `scope=enterprise` and `githubOrg` is present, use organization team APIs for that organization.
  - Treat billing usage as organization override by default. For Premium Request view, use the enterprise premium request source but narrow candidate users through organization teams/seats and per-user calls without also sending `organization` when `user` is present; for Token Usage view, use organization enhanced billing usage endpoints when available.
  - Do not label this as an Enterprise Team filter. Response metadata should set `teamKind: organization_team` and include a message or status copy that identifies the selected organization context.

Important limitations:

- Team filtering is based on current team membership unless GitHub later exposes historical team attribution in billing usage data.
- Current membership filtering may not match membership at the time the usage occurred.
- If the upstream token usage source does not include user identifiers, team filtering cannot produce valid user-level or team-level token rows. In that case the API should return aggregate data only with `dataState: partial` and a message explaining that team filtering requires user-level billing records.
- Team filtering should be performed after model filtering only if both filters operate on normalized user/model rows. If model filtering is delegated to GitHub upstream parameters, the backend must still post-filter the returned user rows by team membership.

### API/Data Flow

Existing route semantics should be reused rather than introducing a separate Premium Usage router. `Options.fromRoute(...)` reads route params and query values, `MainComponent` passes `Options.toParams()` to `PremiumUsageViewer`, and `PremiumUsageViewer` forwards those params to `/api/billing-usage` with `viewMode` and optional `model`.

`PremiumUsageViewer` also owns two billing-specific filters:

- `Team`: the component calls `/api/teams` with the route-derived scope parameters, removes any existing `githubTeam` from the list request, and displays the returned teams in a dropdown. Selecting a team sends `githubTeam={slug}` to `/api/billing-usage`; clearing the dropdown removes `githubTeam`.
- `Timeframe`: the component sends `timeframe=current_month|last_month|this_year|last_year` to `/api/billing-usage`. The backend resolves this to the natural period displayed in `periodStart`/`periodEnd` and constructs the upstream billing query params from that period.

Route and query examples:

- `/enterprises/{ent}?tab=premium%20usage` becomes `scope=enterprise&githubEnt={ent}` and uses enterprise-wide billing plus Enterprise Team semantics only when a team is selected.
- `/enterprises/{ent}/teams/{team}?tab=premium%20usage` becomes `scope=enterprise&githubEnt={ent}&githubTeam={team}` and resolves members from the enterprise team memberships endpoint.
- `/orgs/{org}?tab=premium%20usage` becomes `scope=organization&githubOrg={org}` and uses organization billing plus Organization Team semantics.
- `/orgs/{org}/teams/{team}?tab=premium%20usage` becomes `scope=organization&githubOrg={org}&githubTeam={team}` and resolves members from the organization team members endpoint.
- Enterprise routes that also carry `githubOrg` as an override become `scope=enterprise&githubEnt={ent}&githubOrg={org}`. If `githubTeam` is present, it resolves as an Organization Team in `{org}`.

Backend flow for Premium Request view:

1. Parse and validate `scope`, `githubEnt`, `githubOrg`, `githubTeam`, `viewMode`, `timeframe`, date range, `model`, and optional diagnostic `user`.
2. Select the billing source scope using the source selection rules above. For organization scope, discover whether the organization is standalone or enterprise-owned and emit `billingSourceScope`/`billingEnterpriseSlug` metadata.
3. Resolve `timeframe` to a natural billing period. `current_month` and `last_month` produce `year` plus `month`; `this_year` and `last_year` produce `year` only.
4. If `githubTeam` is present, call `fetchAllTeamMembers(options, headers)` before enumerating Premium Request candidate users.
5. Normalize team members to `{ login, id }`; if no valid members can be parsed, return an empty or partial response according to the error behavior below.
6. Enumerate Copilot seat users for the selected report candidate scope: enterprise seats for enterprise-wide reports, organization seats for organization reports, and organization seats for enterprise routes carrying `githubOrg` as an organization override.
7. Intersect seat users with resolved team members, and also intersect with the optional `user` query if present.
8. Call `premium_request/usage?user={login}` only for the narrowed candidate users, with existing concurrency limits. Do not add the enterprise `organization` filter to these per-user calls.
9. Normalize results into `BillingUsageReport`, preserving zero-usage team members when they were valid candidates.
10. Sort filtered users by `premiumRequests` descending and rebuild `summary` and `modelOptions` from the filtered set.

Live Premium Request performance behavior:

- Parent enterprise discovery, team members, Copilot seat users, and per-user Premium Request responses are cached for a short TTL and keyed by the authorization context.
- Repeated requests for the same billing period, scope, team, and candidate users should reuse cached data.
- Switching between teams should only require GitHub calls for newly encountered team members; overlapping users reuse per-user Premium Request cache entries.

Backend flow for Token Usage view:

1. Parse and validate the same query contract.
2. Select detailed enhanced billing usage for the selected billing source scope; fall back to summary only when detailed records are unavailable.
3. If `githubTeam` is present, resolve members with the correct team endpoint and API version before returning data.
4. Normalize token records only when user and model dimensions are present.
5. If user-level token rows exist, filter them by resolved team members, then sort by `totalTokens` descending and rebuild `summary` and `modelOptions`.
6. If token data is aggregate-only, return `dataState: partial`, keep `users: []`, include aggregate summary when safe, and add a message that team filtering cannot narrow aggregate-only token usage.

The response should carry `teamSlug`, `teamKind`, `teamFilterMethod: current_membership_post_filter`, `resolvedMemberCount`, and `teamFilterWarning` whenever a team filter is requested and resolved far enough to identify the team/member source.

## 4. API Interface

### `GET /api/billing-usage`

Returns normalized premium request and token usage data for the requested scope.

**Query Parameters**

- `scope`: `organization | enterprise`
- `githubOrg`: organization login, required for organization scope
- `githubEnt`: enterprise slug, required for enterprise scope
- `githubTeam`: optional team slug
- `since`: optional ISO date. Defaults to latest 28-day window.
- `until`: optional ISO date. Defaults to latest 28-day window.
- `viewMode`: optional `premium_request | token_usage`. The endpoint can return both metric families when available.
- `model`: optional normalized model key filter
- `sourceApi`: optional diagnostic override for development only, normally selected by backend capability detection
- `isDataMocked`: optional boolean for mock mode
- `user`: optional GitHub login filter for validating or narrowing premium request usage with upstream `user={user-login}`. This is primarily a diagnostic and incremental data-collection parameter until a bulk user-level source is verified.

**Response metadata**

- `billingSourceScope`: `organization` or `enterprise`, describing the billing source actually used.
- `billingEnterpriseSlug`: present when an organization report resolves to enterprise billing.

**Response Body**

- `BillingUsageReport`

**Error and Degraded Responses**

- `401`: no authentication header and mock mode is not enabled.
- `403`: authenticated identity or token cannot access billing/user-level usage data.
- `404`: requested organization, enterprise, or team is not found.
- `422`: GitHub API/report source does not support the requested scope or date range.
- `503`: data source unavailable and no cached/historical data can be used.

For partial data, prefer `200` with `dataState: partial` and explanatory `messages` instead of failing the whole report.

### Permission/Error Behavior

The billing endpoint must never fall back to all-user billing usage when a requested team filter cannot be resolved. The safe failure mode is permission, empty, unavailable, or partial state with minimal diagnostics.

- Team does not exist:
  - Upstream `404` from the team list or member endpoint should return `404` when the requested team slug is invalid or unavailable for the selected team kind.
  - Response text should name the selected team kind (`enterprise_team` or `organization_team`) and selected context, but should not include unrelated team names.
- Team members API returns `403`:
  - Return `403` or `200` with `dataState: permission_denied` only if the application already has a convention for degraded permission responses.
  - Do not return team members, candidate users, or usage rows because the caller is not authorized for the membership source needed to narrow the report.
  - Add a message such as `Billing usage is available, but team membership could not be read for the selected team.`
- Team has zero members:
  - Return `200` with `dataState: complete`, `resolvedMemberCount: 0`, `users: []`, empty `modelOptions`, and zeroed summary totals.
  - Add a message that the selected team has no current members and filtering is based on current membership.
- Team response cannot be parsed:
  - Return `200` with `dataState: partial` or `503` if no safe report can be produced.
  - Do not show all users. Include a message that the team member response did not contain parseable `{ login, id }` values.
- Premium Request per-user calls partially fail after team candidate narrowing:
  - Return `200` with `dataState: partial`, include successfully fetched users only, preserve zero-usage valid candidates when their calls completed, and report the failed user count without exposing raw upstream errors.
- Token Usage lacks user-level records:
  - Return aggregate summary only when available, with `dataState: partial`, `users: []`, and a message that team filtering requires user-level token records.
- Billing usage source returns `403`:
  - Return `403` for the report because the caller cannot access billing usage for the selected source scope. Do not attempt team membership resolution as a fallback.
- Billing usage source is available but team membership source fails:
  - Prefer a permission/error response over unfiltered billing rows. The presence of billing permission alone is not enough to return team-filtered results.

### Future API: `GET /api/billing-usage/pricing`

Optional future endpoint if cost estimation is promoted into a product feature.

**Query Parameters**

- `effectiveDate`: optional ISO date

**Response Body**

- Array of `ModelPricingSnapshot`

This endpoint should be backed by a curated versioned pricing dataset, not scraped at runtime.

## 5. Data Flow

1. `MainComponent` renders the `premium usage` tab and mounts `PremiumUsageViewer`.
2. `PremiumUsageViewer` builds query params from `Options.fromRoute(...)`, current date range, `viewMode`, and model filter.
3. The component calls `GET /api/billing-usage`.
4. The backend validates scope and authentication.
5. The backend fetches data from the configured GitHub billing usage source. For Premium Request live validation, it may pass `user={login}` to test or narrow the upstream response.
6. If a team filter is present, the backend resolves organization or enterprise team members based on `scope`, `githubOrg`, `githubEnt`, and `githubTeam`.
7. The backend normalizes raw data into `BillingUsageReport`.
8. The backend post-filters normalized user rows by the resolved team members when user-level fields are available.
9. The frontend renders KPI summary, display mode switch, model filter, user table, expandable model detail rows, and data state messages.

## 6. Component Design

### `PremiumUsageViewer.vue`

Responsibilities:

- Display mode switch between Premium Request view and Token Usage view.
- Summary cards for report period and totals.
- Model filter and user search.
- User-level table sorted by:
  - Premium Request view: `premiumRequests` descending.
  - Token Usage view: `totalTokens` descending.
- Expandable user rows showing model-level details.
- Empty, partial, permission denied, and unavailable states.
- Clear explanatory copy that requests and tokens are separate billing metrics.

Recommended props:

- `dateRangeDescription`
- `dateRange`
- `queryParams`

Recommended local state:

- `viewMode`
- `selectedModel`
- `search`
- `expandedUserKeys`
- `loading`
- `error`
- `report`

### Main Table Columns

Premium Request view:

- User
- Included requests, if available
- Billed requests, if available
- Premium requests
- Gross amount, if available
- Billed amount, if available

Token Usage view:

- User
- Total tokens
- Input tokens
- Output tokens
- Cached tokens
- Cache write tokens, if available
- Estimated cost, future field

Expanded model detail rows should mirror the active view mode and include one row per model.

## 7. Permissions and Privacy

- This feature should rely on GitHub API authorization for billing/user-level data access.
- The app should not infer billing manager capability from OAuth allowlists alone.
- If GitHub denies user-level billing usage, the UI must show a permission message and must not fall back to less restricted cached user-level data.
- Cached billing usage data must be scoped by organization/enterprise/team/timeframe/user and protected by authorization-scoped cache keys. Cached data must not be shared across tokens or users.
- Team filtering must be treated as a privacy-sensitive operation because it turns enterprise-level data into a narrower user list.
- Team-filtered billing usage should only be returned when the caller is authorized for both the billing usage source and the team membership source.
- Enterprise billing usage endpoints require enterprise administrator or billing manager permissions. Organization billing usage endpoints require organization administrator or equivalent billing permissions.
- Some enterprise billing endpoints do not work with GitHub App tokens or fine-grained PATs according to current docs. The implementation must preserve existing authentication behavior but report clear `403` or capability messages when the configured token type cannot access the selected billing endpoint.

## 8. Transition Strategy

- Before June 1, 2026:
  - Show both Premium Request view and Token Usage view when data is available.
  - Default load uses current-scope Copilot seat candidates and sorts users by Premium Request usage descending; Top N loading can be added later as a performance optimization.
- On or after June 1, 2026:
  - Token Usage view becomes the primary view.
  - Premium Request view can be hidden, disabled, or labeled historical depending on available data.
- Use a runtime feature flag or data capability check rather than hard-coding only a date switch.
- Keep the user table and expandable model detail interaction consistent across both periods.

## 9. High-Level Task Blocks

- [x] Implement source adapter for premium request usage endpoints: enterprise and organization `premium_request/usage`.
- [x] Validate premium request usage with `user={user-login}` and document the actual response shape for enterprise and organization scopes, including the `user` plus `organization` mutual-exclusion constraint.
- [x] Add an enumeration strategy for user-level Premium Request reports by using Copilot seats plus per-user premium request calls, with safe degraded messages for partial failures.
- [ ] Implement source adapter for enhanced billing usage endpoints: enterprise and organization `usage` and `usage/summary`.
- [ ] Add capability detection for Copilot token usage fields in the general billing usage responses.
- [ ] Confirm whether GitHub exposes user and model dimensions for Copilot token usage in `usage` or `usage/summary`; return partial/unavailable states when dimensions are absent.
- [ ] Define shared billing usage TypeScript contracts.
- [ ] Implement `server/services/github-copilot-billing-usage-api.ts` with source adapters and normalization.
- [ ] Implement `GET /api/billing-usage`.
- [ ] Implement organization team post-filtering via `/orgs/{org}/teams/{team_slug}/members`.
- [ ] Implement enterprise team post-filtering via `/enterprises/{enterprise}/teams/{team_slug}/memberships` with API version `2026-03-10`.
- [ ] Add explicit warnings for current-membership team filtering versus historical billing attribution.
- [ ] Add mock billing usage data for organization, enterprise, and team-filter scenarios.
- [ ] Add `PremiumUsageViewer.vue` with display mode switch, model filter, user table, and expandable model details.
- [ ] Wire the `premium usage` tab into `MainComponent` and hidden tab filtering.
- [ ] Add unit tests for normalization, team filtering, permission degradation, current-scope seat candidate selection, and usage sorting.
- [ ] Add component or e2e coverage for Premium Request view, Token Usage view, expandable rows, and model filtering.
- [ ] Document data availability limitations and token cost estimation caveats.

## 10. Risks and Open Questions

- Current premium request API validation does not confirm a bulk organization/enterprise endpoint that returns every user's premium request usage. The implemented path is user enumeration from Copilot seats plus per-user `premium_request/usage?user={user-login}` calls, with caching to avoid repeated calls for the same billing period and user.
- Current public GitHub docs do not show a dedicated Copilot token usage endpoint. Token usage is expected to come from the enhanced billing `usage` or `usage/summary` endpoints when Copilot token/AI Credits records appear there, but this must be verified against real data.
- GitHub may not expose per-user, per-model token billing data through either enhanced billing usage endpoint. If only aggregate token usage is available, the phase 1 per-user/per-model token requirement is blocked by upstream data availability and must be surfaced as a product/data limitation.
- Billing Usage APIs do not expose team filters. Team filtering must be a post-filter based on current organization or enterprise team membership.
- Organization owners may have different user-level visibility than enterprise owners or billing managers.
- Team filtering based on current membership may not match historical membership at the time usage occurred.
- Enterprise teams and organization teams use different GitHub APIs and response shapes, so membership normalization must be tested separately.
- Public model list prices can change over time, so future cost estimation needs a versioned pricing source and clear effective dates.
- Token categories may vary by model provider. Anthropic cache write pricing is one example that should remain optional in the model.
- Existing app internationalization is limited; new UI should follow current conventions first and avoid introducing a partial i18n system unless the broader app adopts it.

## 11. References

- GitHub REST Billing Usage API, Enterprise Cloud, API version 2022-11-28: https://docs.github.com/en/enterprise-cloud@latest/rest/billing/usage?apiVersion=2022-11-28
- GitHub REST Billing Usage API, organization/user endpoints, API version 2022-11-28: https://docs.github.com/en/rest/billing/usage?apiVersion=2022-11-28
- GitHub Docs: Automating usage reporting with the REST API: https://docs.github.com/en/enterprise-cloud@latest/billing/tutorials/automate-usage-reporting
- Premium request validation endpoint: `GET https://api.github.com/enterprises/{enterprise}/settings/billing/premium_request/usage?user={user-login}` with `X-GitHub-Api-Version: 2022-11-28`
