# Design: AI Credit Usage And Budget Reporting

## 1. Overview

- Reference: [docs/design/design-premium-request-token-usage.md](../design/design-premium-request-token-usage.md)
- GitHub Issue: N/A

This design defines the API selection and reporting model for Copilot AI Credit reporting after the migration away from Premium Request as the primary billing view. The design separates four concepts that must not be mixed together:

- billing entity: where GitHub records the bill, either enterprise or standalone organization
- seat membership: which users are eligible to appear in the table for the requested scope
- usage: how many AI Credits a user consumed in a billing period
- budget: whether a spending cap exists for a user, and the configured budget amount

The reporting goal is to support a user-level AI Usage table and an optional budget overlay for the same users.

## 2. Architecture Changes

### Backend

- Keep user-level AI Credit usage on the existing endpoint:
  - `GET /api/billing-usage`
- Add a dedicated budget-reading endpoint for AI Credit budgets:
  - `GET /api/billing-budgets`
- Keep GitHub API integration in the billing service layer:
  - `server/services/github-copilot-billing-usage-api.ts`
- Add a budget-focused adapter in the same service layer or a sibling module if the file becomes too large:
  - `server/services/github-copilot-billing-budgets-api.ts`

### Upstream GitHub APIs To Use

#### User-level AI Credit usage

- Enterprise billing entity:
  - `GET /enterprises/{enterprise}/settings/billing/ai_credit/usage?year={YYYY}&month={M}&user={login}`
- Standalone organization billing entity:
  - `GET /organizations/{org}/settings/billing/ai_credit/usage?year={YYYY}&month={M}&user={login}`

These endpoints provide usage and billing breakdown for a single user in a billing period.

#### Candidate user enumeration

- Enterprise seats:
  - `GET /enterprises/{enterprise}/copilot/billing/seats`
- Organization seats:
  - `GET /orgs/{org}/copilot/billing/seats`

These endpoints determine which users should appear in the table for the requested scope. They do not provide AI Credit quota or balance fields.

#### Billing entity resolution for organization scopes

- REST organization metadata:
  - `GET /orgs/{org}`
- Fallback enterprise discovery:
  - `POST /graphql`

These endpoints determine whether an organization is billed directly or through a parent enterprise.

#### User AI Credit budgets

- Read all budgets on the enterprise billing entity:
  - `GET /enterprises/{enterprise}/settings/billing/budgets`

Live validation confirms that this endpoint can return records such as:

- `budget_scope = user`
- `budget_product_sku = ai_credits`
- `budget_type = BundlePricing`
- `user = {login}`
- `budget_amount = {number}`

This endpoint should be treated as the source of truth for user budget configuration.

#### Optional future budget management APIs

- Create a budget:
  - `POST /enterprises/{enterprise}/settings/billing/budgets`
- Update a budget:
  - `PATCH /enterprises/{enterprise}/settings/billing/budgets/{budget_id}`
- Delete a budget:
  - `DELETE /enterprises/{enterprise}/settings/billing/budgets/{budget_id}`

These are management APIs and are not required for read-only reporting.

## 3. Billing Entity Rules

- If the requested scope is `enterprise`, the billing entity is the enterprise.
- If the requested scope is `organization` and the org has a parent enterprise, the billing entity is the parent enterprise.
- If the requested scope is `organization` and the org has no parent enterprise, the billing entity is the organization.
- If the requested scope is a team, the team only constrains the candidate user set. The billing entity still comes from the rules above.

Important constraint:

- Do not combine `organization` and `user` when querying enterprise AI Credit usage.
- For enterprise-owned organization reports, narrow the user set through organization seats or team membership, then query enterprise usage once per user without the `organization` parameter.

## 4. Data Model

### User usage record

- `login`
- `userId`
- `aiCredits`
- `includedCredits`
- `additionalCredits`
- `grossAmountUsd`
- `additionalUsageUsd`
- `models[]`

These fields come from AI Credit usage responses.

### User budget record

- `login`
- `budgetId`
- `budgetAmount`
- `budgetScope`
- `budgetType`
- `budgetProductSku`
- `preventFurtherUsage`
- `alerting`

These fields come from enterprise budgets responses.

### Combined reporting view

- `login`
- `usage`
  - `aiCredits`
  - `includedCredits`
  - `additionalCredits`
  - `grossAmountUsd`
  - `additionalUsageUsd`
- `budget`
  - `budgetAmount`
  - `preventFurtherUsage`
  - `hasBudget`
- `derived`
  - `remainingBudgetUsd` optional and explicitly labeled as application-derived

`remainingBudgetUsd` must be treated as computed application logic, not a GitHub-provided field.

## 5. API Interface

### Internal reporting API for usage

- `GET /api/billing-usage`

Key query parameters:

- `scope=enterprise|organization`
- `githubEnt={enterprise}`
- `githubOrg={org}`
- `githubTeam={team}` optional
- `viewMode=ai_credit`
- `sourceApi=ai_credit_usage`
- `timeframe=current_month|last_month|this_year|last_year`
- `user={login}` optional for single-user diagnostics

### Proposed internal reporting API for budgets

- `GET /api/billing-budgets`

Key query parameters:

- `scope=enterprise|organization`
- `githubEnt={enterprise}` when the billing entity is enterprise
- `githubOrg={org}` optional for page context only
- `user={login}` optional
- `budgetScope=user` default for the user budget table
- `budgetProductSku=ai_credits` default
- `budgetType=BundlePricing` default

Expected behavior:

- resolve the billing entity first
- query the enterprise budgets endpoint when the billing entity is enterprise
- filter budgets in application code to match:
  - `budget_scope = user`
  - `budget_product_sku = ai_credits`
  - `budget_type = BundlePricing`
  - `user = {login}` when a user filter is provided

## 6. Reporting Semantics

- AI Credit usage answers: how much the user consumed
- User budget answers: whether the user has a configured spending cap and what the amount is
- Seat APIs answer: whether the user is in scope for the report

The budget amount should be described as a spending budget or cap, not as a GitHub-provided seat quota field.

The following interpretation is recommended:

- `Included Credits` means usage already covered by bundled allowance in the usage response
- `Budget Amount` means configured spending cap from the budgets API
- `Remaining Budget` is optional and should be computed only in the application layer

## 7. High-Level Task Blocks

- [ ] Add `GET /api/billing-budgets` endpoint
- [ ] Add enterprise budget adapter for `settings/billing/budgets`
- [ ] Filter user AI Credit budgets by `budget_scope`, `budget_product_sku`, `budget_type`, and `user`
- [ ] Join budget data to the existing user-level AI Credit usage table
- [ ] Expose optional derived fields such as remaining budget with explicit labeling
- [ ] Add tests for enterprise-owned organization and standalone organization billing entity resolution
- [ ] Document customer-facing field meanings and API limitations