# Implementation Plan: Premium Request Analytics / Token Usage

## References

- Requirement: [docs/requirements/req-premium-request-token-usage.md](../requirements/req-premium-request-token-usage.md)
- Design: [docs/design/design-premium-request-token-usage.md](../design/design-premium-request-token-usage.md)
- GitHub Issue: https://github.com/github-copilot-resources/copilot-metrics-viewer/issues/362

## Planning Notes

- The feature must remain a separate billing usage domain and must not reuse existing Copilot activity metrics models such as `UserTotals`.
- Premium Request data comes from GitHub Billing Usage `premium_request/usage` endpoints, but current validation only confirms a single-user query path with `user={user-login}`. Do not assume one unfiltered organization or enterprise call can return every user's premium request usage.
- Organization Premium Request source selection must distinguish standalone organizations from enterprise-owned organizations. Standalone organizations use organization billing; enterprise-owned organizations resolve a parent enterprise visible to the current token and use enterprise billing while keeping organization teams/seats as the candidate-user boundary.
- GitHub enterprise premium request usage does not allow `user` and `organization` filters together. Per-user calls use `user={login}` only; organization/team narrowing is enforced by candidate-user selection.
- Premium Usage live-data calls use short-lived, authorization-scoped in-memory caches for parent enterprise discovery, team members, Copilot seats, and per-user Premium Request usage.
- Token Usage data should be adapter-driven over enhanced billing `usage` and `usage/summary` endpoints until GitHub exposes or documents a dedicated Copilot token usage endpoint.
- Team filtering is not supported by Billing Usage APIs and must be implemented by resolving current team membership, then post-filtering normalized user-level billing rows. If user-level billing rows are produced by per-user upstream calls, team filtering should reduce the candidate user list before making those calls.
- If upstream token usage data does not include user and model dimensions, the API must return partial or unavailable state with explicit messages rather than fabricating per-user/per-model data.

## Phase 1: Shared Contracts and Mock Data

- [x] **Task 1.1**: Create shared billing usage contracts in `shared/` or `app/types/` for `BillingUsageReport`, `BillingUsageSummary`, `BillingUsageUser`, `BillingUsageModelDetail`, `ModelPricingSnapshot`, `BillingUsageViewMode`, `BillingUsageDataState`, `BillingUsageSourceApi`, and team filter metadata.
- [x] **Task 1.2**: Define raw upstream response interfaces for premium request usage, billing usage detail, and billing usage summary responses under the new billing service module.
- [x] **Task 1.3**: Add type guards or parser helpers that safely handle missing optional upstream fields such as `user`, `model`, token categories, and amount fields.
- [x] **Task 1.4**: Add mock premium request data for organization scope, including multiple users, models, gross quantity, discounted quantity, net quantity, and amount fields.
- [x] **Task 1.5**: Add mock premium request data for enterprise scope, including organization attribution where available.
- [x] **Task 1.6**: Add mock token usage data with Copilot token-like `product`, `sku`, and `unitType` fields, including input, output, cached, and cache write token categories where applicable.
- [x] **Task 1.7**: Add mock degraded token usage data where only aggregate totals are available and user/model dimensions are missing.
- [x] **Task 1.8**: Add mock team membership scenarios for organization team, enterprise team, and enterprise scope with organization override.

## Phase 2: Billing Usage Service

- [x] **Task 2.1**: Create `server/services/github-copilot-billing-usage-api.ts` as the single backend service boundary for billing usage data.
- [x] **Task 2.2**: Implement premium request URL construction for `GET /enterprises/{enterprise}/settings/billing/premium_request/usage` and `GET /organizations/{org}/settings/billing/premium_request/usage`.
- [x] **Task 2.2a**: Support upstream `user={user-login}` query forwarding so the known single-user premium request endpoint can be tested through `/api/billing-usage`.
- [x] **Task 2.3**: Implement enhanced billing usage URL construction for enterprise and organization `usage` and `usage/summary` endpoints.
- [x] **Task 2.4**: Map app billing timeframe inputs to GitHub Billing Usage query parameters. Month timeframes derive `year` and `month`; year timeframes derive `year` only. Premium Usage defaults to the current calendar month instead of a rolling 28-day window.
- [x] **Task 2.5**: Pass `X-GitHub-Api-Version: 2022-11-28` to Billing Usage requests while preserving existing authorization headers from the request context.
- [x] **Task 2.6**: Implement `fetchPremiumRequestUsage(options, headers, filters)` for enterprise and organization scope.
- [x] **Task 2.7**: Implement `fetchBillingUsage(options, headers, filters)` for detailed enhanced billing usage.
- [x] **Task 2.8**: Implement `fetchBillingUsageSummary(options, headers, filters)` for aggregate enhanced billing usage fallback.
- [x] **Task 2.9**: Implement source capability detection that determines whether returned billing usage records contain Copilot token fields, user fields, and model fields.
- [x] **Task 2.10**: Normalize premium request records into `BillingUsageUser[]` and `BillingUsageModelDetail[]`, preserving included, billed, gross, discount, net, and amount fields.
- [x] **Task 2.11**: Normalize token usage records into token category totals by user and model when those dimensions exist.
- [x] **Task 2.12**: Normalize aggregate-only token responses into `BillingUsageSummary` with `dataState: partial` and clear messages.
- [x] **Task 2.13**: Implement model filter handling through upstream `model` query parameters for premium request usage where supported, and through normalized-row filtering for token usage.
- [x] **Task 2.14**: Implement current-scope user sorting by premium request usage for normalized user rows; Top N limiting is deferred as a future performance optimization.
- [x] **Task 2.14a**: Implement a real live-data Premium Request user collection strategy by enumerating authorized Copilot seat users, calling `premium_request/usage?user={login}` with concurrency limits, including zero-usage users, and sorting users by premium request usage descending.
- [x] **Task 2.14b**: Implement parent-enterprise discovery for organization-scope Premium Request reports using REST organization metadata first and GraphQL `viewer.enterprises` organization lookup as fallback.
- [x] **Task 2.14c**: Ensure per-user enterprise Premium Request calls do not send `organization` together with `user`, and rely on org seats/team candidates for organization scoping.
- [x] **Task 2.15**: Implement token view sorting by total tokens descending.
- [x] **Task 2.16**: Add diagnostic `sourceApi` and `messages` output so the UI can explain which source produced the response and why data is partial.
- [x] **Task 2.17**: Add `billingSourceScope` and `billingEnterpriseSlug` response metadata so org reports can show whether billing was sourced from organization or enterprise.

## Phase 3: Team Filtering and Authorization Behavior

- [x] **Task 3.1**: Reuse or extract `fetchAllTeamMembers(options, headers)` from `server/api/seats.ts` so billing usage can resolve team members without duplicating pagination and enterprise API-version logic.
- [x] **Task 3.2**: For `scope=organization`, resolve `githubTeam` through `/orgs/{org}/teams/{team_slug}/members` and set `teamKind: organization_team`.
- [x] **Task 3.3**: For `scope=enterprise` without `githubOrg`, resolve `githubTeam` through `/enterprises/{enterprise}/teams/{team_slug}/memberships` with `X-GitHub-Api-Version: 2026-03-10` and set `teamKind: enterprise_team`.
- [x] **Task 3.4**: For `scope=enterprise` with `githubOrg`, resolve `githubTeam` through `/orgs/{org}/teams/{team_slug}/members`, set `teamKind: organization_team`, and treat billing usage as an organization override by default.
- [x] **Task 3.5**: Normalize both flat organization member responses and enterprise membership responses into stable `{ login, id }` values before filtering.
- [x] **Task 3.6**: For Premium Request live reports, resolve team members before enumerating per-user premium request usage, intersect team members with Copilot seat users, and call `premium_request/usage?user={login}` only for the narrowed candidate set.
- [x] **Task 3.7**: If a diagnostic `user` query is present with a team filter, intersect that user with the resolved team member set before calling upstream billing usage; return an empty filtered report if the user is not a current team member.
- [x] **Task 3.8**: For Token Usage reports with user-level records, filter normalized billing users by login and user ID after normalization, then rebuild `summary`, `modelOptions`, and sorting from the filtered set.
- [x] **Task 3.9**: Return `dataState: partial` with `users: []` and aggregate summary only when team filtering is requested but upstream token data lacks user identifiers; do not fabricate user-level or team-level token rows.
- [x] **Task 3.10**: Add `teamFilterMethod: current_membership_post_filter`, `resolvedMemberCount`, and `teamFilterWarning` to team-filtered responses.
- [x] **Task 3.11**: Implement safe degraded behavior for team-not-found, team membership `403`, empty team, and unparseable team member responses; never fall back to unfiltered all-user usage when `githubTeam` was requested.
- [x] **Task 3.12**: Ensure cached billing usage inputs remain protected by authorization-scoped cache keys and do not cross token/user boundaries.
- [x] **Task 3.13**: Add short-lived caches and in-flight request de-duplication for team members, Copilot seats, parent-enterprise discovery, and per-user Premium Request usage.

## Phase 4: Server API Endpoint

- [x] **Task 4.1**: Create `server/api/billing-usage.ts` as the Nuxt server endpoint for `GET /api/billing-usage`.
- [x] **Task 4.2**: Parse query parameters through `Options.fromQuery`, including `scope`, `githubOrg`, `githubEnt`, `githubTeam`, `since`, `until`, `viewMode`, `model`, `sourceApi`, and `isDataMocked`.
- [x] **Task 4.3**: Validate required scope inputs: `githubOrg` for organization scope and `githubEnt` for enterprise scope.
- [x] **Task 4.4**: Reject unsupported `viewMode`, invalid date ranges, and invalid diagnostic `sourceApi` values with `400` or `422` responses.
- [x] **Task 4.4a**: Reject unsupported `timeframe` values and support `current_month`, `last_month`, `this_year`, and `last_year` natural billing periods.
- [x] **Task 4.5**: Support mock mode by returning mock billing usage reports without requiring GitHub authentication.
- [x] **Task 4.6**: Require authentication headers for live GitHub Billing Usage requests.
- [x] **Task 4.7**: Select premium request adapter, detailed billing usage adapter, or summary fallback based on requested view and source capabilities.
- [x] **Task 4.8**: Apply team filtering after normalization when user-level records exist.
- [x] **Task 4.8a**: Move live Premium Request team filtering ahead of per-user premium request collection so team members reduce the candidate user set before upstream `user={login}` calls.
- [x] **Task 4.8b**: Document and enforce source selection for organization and enterprise-org override contexts: standalone org uses org billing; enterprise-owned org uses enterprise billing; org team/seats define the candidate-user boundary; per-user enterprise calls omit `organization` when `user` is present.
- [x] **Task 4.9**: Return `401`, `403`, `404`, `422`, and `503` errors consistently with existing server API conventions.
- [x] **Task 4.10**: Prefer `200` with `dataState: partial` for partial token capability, missing token categories, or aggregate-only token data.

## Phase 5: Backend Unit and Integration Tests

- [x] **Task 5.1**: Add tests for premium request normalization by user and model.
- [ ] **Task 5.2**: Add tests for token usage normalization by user and model.
- [ ] **Task 5.3**: Add tests for aggregate-only token fallback and partial data messages.
- [ ] **Task 5.4**: Add tests for source capability detection across complete, partial, unavailable, and permission-denied responses.
- [ ] **Task 5.5**: Add tests for model filtering in Premium Request view and Token Usage view.
- [x] **Task 5.6**: Add tests that Premium Request keeps all current-scope users sorted by usage descending without applying a Top 10 limit.
- [ ] **Task 5.7**: Add tests for token usage sorting by total tokens.
- [x] **Task 5.8**: Add tests for organization team post-filtering by login and user ID.
- [x] **Task 5.9**: Add tests for enterprise team membership normalization and post-filtering.
- [x] **Task 5.10**: Add tests for enterprise scope with organization team override and enterprise-owned organization billing source discovery.
- [x] **Task 5.11**: Add tests that Premium Request team filtering narrows the candidate users before per-user upstream calls and does not call premium request usage for users outside the selected team.
- [x] **Task 5.11a**: Add tests that Premium Usage timeframe values resolve to natural billing month/year periods.
- [x] **Task 5.12**: Add tests for diagnostic `user` plus team filter intersection, including the user-not-in-team empty result path.
- [x] **Task 5.15**: Add tests that repeated Premium Request team reports reuse cached team members, seats, and per-user usage calls.
- [ ] **Task 5.13**: Add tests for aggregate-only Token Usage with team filter returning `dataState: partial`, `users: []`, and an explicit message rather than fabricated rows.
- [ ] **Task 5.14**: Add tests for team not found, team membership `403`, empty team, unparseable membership response, no-auth, forbidden billing usage, upstream unavailable, and invalid query scenarios.

## Phase 6: Frontend Component

- [x] **Task 6.1**: Create `app/components/PremiumUsageViewer.vue` using existing Vuetify table and loading/error patterns.
- [x] **Task 6.2**: Define props for date range description, date range, and route-derived query params.
- [x] **Task 6.3**: Add local state for `viewMode`, `selectedModel`, `search`, `expandedUserKeys`, `loading`, `error`, and `report`.
- [x] **Task 6.3a**: Add local state for `selectedTeam`, loaded team options, team loading state, and selected billing timeframe.
- [x] **Task 6.4**: Fetch `GET /api/billing-usage` when the component mounts or when view mode, model filter, team filter, or billing timeframe changes.
- [x] **Task 6.5**: Render summary metrics for report period, total users, premium request totals, token totals, and data state messages.
- [x] **Task 6.6**: Add a segmented control or tab-like switch for `premium_request` and `token_usage` display modes.
- [x] **Task 6.7**: Add a model filter using `report.modelOptions`.
- [x] **Task 6.7a**: Add a visible Team dropdown populated from `GET /api/teams`, forwarding selected values as `githubTeam` and clearing the filter when All teams is selected.
- [x] **Task 6.7b**: Add a visible Timeframe dropdown with Current month, Last month, This year, and Last year options.
- [x] **Task 6.8**: Add a user search input for filtering displayed user rows client-side.
- [x] **Task 6.9**: Render Premium Request table columns: user, included requests, billed requests, premium requests, gross amount, and billed amount when available.
- [x] **Task 6.10**: Render Token Usage table columns: user, total tokens, input tokens, output tokens, cached tokens, cache write tokens, and estimated cost when available.
- [x] **Task 6.11**: Implement expandable user rows that render per-model details matching the active display mode.
- [x] **Task 6.12**: Add empty, partial, permission denied, unavailable, and loading states.
- [x] **Task 6.13**: Show team filtering warnings when `teamFilterWarning` is present.
- [x] **Task 6.14**: Ensure the UI explains unavailable token categories without silently rendering blank values.
- [x] **Task 6.15**: Keep request and token metrics visually distinct so users do not infer a direct conversion between them.

## Phase 7: Frontend Integration

- [x] **Task 7.1**: Add `premium usage` to `tabItems` in `app/components/MainComponent.vue`.
- [x] **Task 7.2**: Import and render `PremiumUsageViewer.vue` inside the matching `v-window-item`.
- [x] **Task 7.3**: Pass existing route-derived options, date range, and date range description into the component.
- [x] **Task 7.4**: Ensure hidden tab filtering and configurable tabs include the new `premium usage` tab.
- [x] **Task 7.5**: Ensure dashboard state does not block existing metrics, seats, user metrics, or API response tabs.
- [x] **Task 7.6**: Add navigation/manual validation notes for organization, enterprise, organization team, and enterprise team URLs.

## Phase 8: Frontend and E2E Tests

- [x] **Task 8.1**: Add component tests for Premium Request view rendering with user rows.
- [x] **Task 8.2**: Add component tests for Token Usage view rendering with user rows.
- [x] **Task 8.3**: Add component tests for display mode switching.
- [ ] **Task 8.4**: Add component tests for model filter and user search behavior.
- [x] **Task 8.5**: Add component tests for partial token data messages.
- [ ] **Task 8.6**: Add component tests for permission denied and unavailable states.
- [x] **Task 8.7**: Add E2E coverage for the `premium usage` tab in organization scope using mock data.
- [x] **Task 8.8**: Add E2E coverage for the `premium usage` tab in enterprise scope using mock data.
- [ ] **Task 8.9**: Add E2E coverage for organization team filtering using mock data, including route/path team parameter propagation into `/api/billing-usage`.
- [ ] **Task 8.10**: Add E2E coverage for enterprise team filtering using mock data when route support is available.
- [x] **Task 8.11**: Add integration coverage for enterprise scope with `githubOrg` override, verifying that organization seats define the candidate boundary while enterprise billing remains the Premium Request source.

## Phase 9: Documentation and Operational Readiness

- [ ] **Task 9.1**: Update README or feature documentation with the new Premium Request Analytics / Token Usage tab.
- [ ] **Task 9.2**: Document required GitHub token permissions and endpoint limitations for enterprise and organization billing usage.
- [ ] **Task 9.3**: Document that GitHub Billing Usage APIs do not support native team filters and that team filtering uses current membership post-filtering.
- [ ] **Task 9.4**: Document token data limitations and the behavior when only aggregate enhanced billing usage data is available.
- [ ] **Task 9.5**: Document that cost estimation is future-compatible and must not be treated as billed cost unless backed by official billed amount fields.
- [ ] **Task 9.6**: Add release notes or changelog entry if this feature is included in a release branch.

## Phase 10: Verification

- [ ] **Task 10.1**: Run `npm test` and confirm all unit tests pass or document unrelated existing failures.
- [ ] **Task 10.2**: Run targeted tests for billing usage service and `PremiumUsageViewer.vue`.
- [ ] **Task 10.3**: Run `npm run build` and confirm the production build completes.
- [ ] **Task 10.4**: Run `npm run lint` and document known existing lint failures without introducing new ones.
- [ ] **Task 10.5**: Start `npm run dev` in mock mode and validate `http://localhost:3000/orgs/mocked-org?mock=true`.
- [x] **Task 10.6**: Manually validate organization scope Premium Request view, Token Usage view, row expansion, model filtering, and partial data states.
- [x] **Task 10.7**: Manually validate enterprise scope Premium Request view, Token Usage view, row expansion, model filtering, and partial data states.
- [x] **Task 10.7a**: Manually validate enterprise single-user Premium Request API through `/api/billing-usage?scope=enterprise&githubEnt=<enterprise>&viewMode=premium_request&user=<login>` and compare it with `https://api.github.com/enterprises/<enterprise>/settings/billing/premium_request/usage?user=<login>` using `X-GitHub-Api-Version: 2022-11-28`.
- [x] **Task 10.8**: Manually validate organization team filtering and team filter warning copy, including standalone organization teams and enterprise-owned organization teams.
- [x] **Task 10.9**: Manually validate enterprise team filtering through `/api/billing-usage?scope=enterprise&githubEnt=<enterprise>&githubTeam=<enterprise-team>&viewMode=premium_request` or document upstream permission/data blockers.
- [x] **Task 10.10**: Manually validate enterprise organization override through `/api/billing-usage?scope=enterprise&githubEnt=<enterprise>&githubOrg=<org>&githubTeam=<org-team>&viewMode=premium_request` and confirm organization-team membership semantics.
- [x] **Task 10.13**: Manually validate Premium Usage cache behavior: repeated organization team and enterprise team requests reuse cached data and avoid repeated GitHub API fan-out.
- [ ] **Task 10.11**: Manually validate aggregate-only Token Usage plus team filter returns partial state without user rows.
- [x] **Task 10.12**: Confirm no secrets or credentials are added to changed files before opening a PR.

## Developer Handoff Checklist

- [ ] Start work from the latest `develop` branch, then create a feature branch named `feature/362-premium-request-token-usage`.
- [ ] Keep production configuration, workflows, `.env`, Dockerfile, and Azure deployment files unchanged unless explicitly approved.
- [ ] Implement backend contracts and normalization before UI work.
- [ ] Use mock data to unblock UI and tests before relying on real GitHub Billing Usage responses.
- [ ] Treat token usage source shape as untrusted until verified against real enhanced billing data.
- [ ] Preserve clear degraded states for unsupported token dimensions, permission failures, and team filtering limitations.