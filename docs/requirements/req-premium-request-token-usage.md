# Requirement: Premium Request Analytics / Token Usage

GitHub Issue: https://github.com/github-copilot-resources/copilot-metrics-viewer/issues/362

## 中文版

## 1. 背景与价值

- **用户故事**：作为 GitHub Copilot Enterprise/Organization 管理员或 Billing Manager，我希望在 Copilot Metrics Viewer 中查看 Premium Request 与 Token Usage 的使用分析，以便在 GitHub Copilot 计费模型切换后持续掌握企业、团队、用户和模型维度的消耗情况，并支持预算核对与成本治理。
- **业务价值**：
  - 当前管理员可以在 GitHub.com 的 Billing > Usage > Premium request analytics 中查看 enterprise/organization 的 premium request 使用情况，包括按用户、模型、组织或成本中心筛选和分组。
  如类似[current-premium-request-analystics-byuser.png](current-premium-request-analystics-byuser.png)。

  - 当前 GitHub.com billing 的按用户展示模式以用户列表为核心：每一行展示单个用户的 request 使用汇总，点击用户后可以展开查看该用户在不同模型上的 request 次数。参考截图：[current-premium-request-analystics-byuser.png](current-premium-request-analystics-byuser.png)。
  - GitHub Copilot 将从 2026-06-01 起从 premium request-based billing 转向 usage-based billing，premium request units 将被 GitHub AI Credits 取代。
  - 新计费方式将基于 token 消耗计算，包括 input tokens、output tokens、cached tokens，以及特定模型的 cache write 等价格维度；不同模型有不同的 list price，价格单位为每 100 万 tokens。
  - 企业需要在本系统中提前建立从 Premium Request 到 Token Usage 的过渡视图，既能复用当前 GitHub.com billing analytics 的理解方式，也能为 6/1 后的 token-only 模式做准备。
  - 该能力可以帮助企业识别高使用用户、高消耗模型、团队级消耗趋势，并辅助团队核对个人 token 费用和预算消耗。
  - Premium Usage 页面需要支持管理员按团队缩小查看范围，优先服务团队负责人、成本中心负责人和 Billing Manager 对单个团队内成员 premium request 使用情况的核对与治理。

## 2. 范围与边界

- **范围内**：
  - 新增 Premium Request Analytics / Token Usage 报表能力。
  - 报表支持两种显示模式切换：
    - Premium Request view：按照 premium request 口径展示，体验应接近当前 GitHub.com billing 中的 premium request analytics。
    - Token Usage view：按照 token 使用口径展示。
  - Premium Request view 需要采用按用户汇总的列表形态：用户行展示该用户 request 使用汇总，展开后展示该用户按模型拆分的 request 次数。
  - Token Usage view 需要沿用相同的信息架构：用户行展示该用户 token 使用汇总，展开后展示该用户按模型拆分的 token 使用明细。
  - 未来 token-only 阶段的核心体验不是新增一套完全不同的页面，而是在当前按用户展开模型明细的 reporting pattern 中，将 request 指标替换为 token 指标。
  - Token Usage 在第一阶段采用 capability-driven 方式：当 GitHub API 返回用户、模型和 token 分类维度时展示明细；当具体 API 或字段尚不可用时，返回 partial/unavailable 状态并说明限制。
  - 默认展示当前自然月每个用户的 Premium Request 使用情况，因为 premium request 额度按自然月计算并在下月重置。
  - 默认展示当前自然月每个用户、每个模型的 token 使用情况，后续 token 额度也应按账单自然月/自然年口径查询。
  - Token Usage 需要在源数据可用时尽可能区分 input tokens、output tokens、cached tokens，以及模型价格页中存在的其他相关 token 计费维度；在 GitHub 尚未提供稳定字段前不强制承诺分类完整性。
  - 报表支持按 Team 筛选，Premium Usage 页面必须提供可见的 Team 下拉框，并根据当前 scope 加载 Enterprise Team 或 Organization Team 列表。
  - 报表支持账单周期筛选，Premium Usage 页面必须提供 Timeframe 下拉框，至少支持 Current month、Last month、This year、Last year。默认值为 Current month。
  - Team 筛选必须区分 Enterprise Team 与 Organization Team：
    - 当 `scope=enterprise` 且没有选定 organization 上下文时，Team 默认指 Enterprise Team。
    - 当 `scope=organization` 时，Team 指 Organization Team。
    - 当 enterprise 视角进入某个 organization 上下文时，Team 可以指该 organization 内的 Organization Team，但需要在页面语义或状态中避免与 Enterprise Team 混淆。
  - Organization 范围必须区分 billing owner：
    - Standalone Organization 的 Premium Request billing 挂在 organization，自身使用 organization premium request endpoint。
    - Enterprise-owned Organization 的 Premium Request billing 挂在 parent enterprise。系统需要自动识别当前 token 可见的 parent enterprise，并通过 enterprise premium request endpoint 获取 per-user usage，同时保留 organization team 和 organization seats 作为用户候选边界。
    - 当 GitHub API 无法反查 parent enterprise 或调用者无权枚举 enterprise/org 关系时，系统需要安全回退到 standalone organization billing 语义或返回清晰的权限/数据状态，而不能伪造 enterprise 归属。
  - Premium Usage 的 Team 筛选需要先解析团队成员，再基于成员集合过滤用户级 premium request/token usage 结果；GitHub Billing Usage/Premium Request API 不应被假定支持原生 `team` 查询参数。
  - Premium Request per-user 调用不得同时向 GitHub enterprise premium request endpoint 传递 `user` 和 `organization`，因为 GitHub API 明确要求二者只能二选一。Enterprise-owned Organization 场景应通过 organization team members、organization seats 和 per-user usage candidate set 限定用户范围。
  - 过滤后仍保持现有排序、搜索和分页体验：用户列表默认按 usage 指标从高到低排序，Premium Request view 按 premium request 使用次数排序，Token Usage view 按 token 总量排序；表格搜索和分页继续作用于过滤后的用户集合。
  - 报表支持按 Model 筛选。
  - 默认视图按当前 scope 枚举可授权访问的 Copilot seat 用户：enterprise scope 加载 enterprise seats，organization scope 加载 organization seats，enterprise + organization override 加载该 organization 的 seats；用户列表按 usage 指标降序展示并保留分页。
  - Top N、延迟加载或其他减少首次集中加载成本的优化作为后续性能增强，不作为第一阶段验收要求。
  - 支持 Enterprise 与 Organization 管理视角，具体可见性遵循 GitHub 官方权限与可用数据范围。
  - 6/1 后产品应逐步切换为 token-only 展示模式。
  - 未来需要基于每个模型的 list price 计算每个人的 token 费用，方便团队进行费用核对。
- **范围外**：
  - 第一阶段不包含预算设置、预算告警或自动限额控制。
  - 第一阶段不包含真实扣费、AI Credits 购买或余额管理。
  - 第一阶段不承诺展示 GitHub 尚未开放或当前权限无法访问的数据字段。
  - 第一阶段不包含 Copilot code review 的 GitHub Actions minutes 成本核算；该项可作为后续扩展单独评估。

## 3. 验收标准

- [ ] AC1：管理员可以进入 Premium Request Analytics / Token Usage 报表页面。
- [ ] AC2：报表提供 Premium Request view 与 Token Usage view 两种显示模式，并允许用户切换。
- [ ] AC3：默认页面展示当前 scope 下可授权访问的 Copilot seat 用户在当前自然月的 Premium Request 使用情况，并按 premium request 使用次数降序排序。
- [ ] AC4：Premium Request view 至少展示用户、使用时间范围、premium request 使用量，以及与当前 GitHub.com billing analytics 对齐的核心汇总信息。
- [ ] AC5：Premium Request view 采用用户级列表展示，每个用户行可以展开，展开后展示该用户按模型拆分的 request 次数。
- [ ] AC6：Token Usage view 采用与 Premium Request view 一致的用户级列表和展开交互，每个用户行可以展开，展开后展示该用户按模型拆分的 token 使用明细。
- [ ] AC7：当 GitHub token usage 数据包含用户和模型维度时，Token Usage view 展示所选自然账单周期内每个用户针对每个模型的 token 使用明细；否则显示 partial/unavailable 状态。
- [ ] AC8：Token Usage view 能按模型聚合展示 token 使用量。
- [ ] AC9：token-only 阶段应在相同的用户列表与模型展开结构中，将 request 相关列和指标替换为 token 相关列和指标。
- [ ] AC10：当 token 明细数据可用时，报表展示 input tokens、output tokens、cached tokens；如果具体 token API 或某些 token 分类尚不可用，页面需要明确说明数据不可用而不是静默为空。
- [ ] AC11：用户可以通过 Premium Usage 页面上的 Team 下拉框筛选报表数据。
- [ ] AC12：在 `scope=enterprise` 且未选定 organization 上下文时，Team 筛选使用 Enterprise Team，并通过 GitHub Enterprise Team 成员 API 解析成员后过滤 Premium Usage 用户列表。
- [ ] AC13：在 `scope=organization` 时，Team 筛选使用 Organization Team，并沿用 organization team 成员解析语义过滤 Premium Usage 用户列表。
- [ ] AC13a：当 organization 是 standalone organization 时，Premium Request view 使用 organization billing source，并支持 Organization Team 筛选。
- [ ] AC13b：当 organization 属于 GitHub Enterprise 时，Premium Request view 自动识别 parent enterprise，使用 enterprise billing source 获取 per-user usage，同时使用 Organization Team 和 organization seats 限定用户候选集。
- [ ] AC14：页面或数据状态需要明确区分 Enterprise Team 与 Organization Team，避免用户误以为两类 Team 可以互换或共享同一权限/API。
- [ ] AC15：Team 筛选后，Premium Request view 仍按 premium request 使用次数降序展示过滤后的用户；Token Usage view 仍按 token 总量降序展示过滤后的用户。
- [ ] AC16：Team 筛选后，表格搜索、分页、用户展开和模型明细继续作用于过滤后的用户集合，并与现有未筛选体验保持一致。
- [ ] AC17：当团队不存在、团队成员为空或团队成员 API 返回无法解析的数据时，页面需要显示清晰的空状态或 partial 说明，不应静默显示全量用户。
- [ ] AC18：当调用者有 billing usage 权限但没有对应 Team 成员读取权限时，页面需要显示明确的权限说明，并不得泄露该 Team 内无权限查看的用户列表或用量明细。
- [ ] AC19：用户可以通过 Model 筛选报表数据。
- [ ] AC20：筛选条件变化后，当前 scope 用户列表、Premium Request 数据、Token Usage 数据和模型明细同步更新。
- [ ] AC20a：用户可以通过 Timeframe 下拉框在 Current month、Last month、This year、Last year 之间切换，后端按自然月或自然年构造 GitHub billing usage 查询参数。
- [ ] AC21：报表保留从 Premium Request 到 Token Usage 的过渡语义，避免用户误解两类指标可以直接等价换算。
- [ ] AC22：6/1 后，当业务口径进入 token-only 阶段时，报表可以隐藏或降级 Premium Request view，并以 Token Usage view 作为主视图。
- [ ] AC23：未来费用核算能力上线后，系统可以基于每个模型的公开 list price 估算每个用户的 token 费用。
- [ ] AC24：当没有数据、数据延迟或当前角色无权查看用户级数据时，页面需要显示清晰的空状态或权限说明。

## 4. 非功能需求

- **安全性**：仅授权的 Enterprise Owner、Organization Admin、Billing Manager 或具备等效权限的角色可以查看用户级和费用级数据。
- **隐私**：用户级数据展示必须遵循 GitHub 官方权限限制；无权限角色不得看到个人级 token 或 premium request 明细。
- **Team 权限边界**：Enterprise Team 和 Organization Team 是不同对象，依赖不同 GitHub API 与权限模型。系统必须按当前 scope 选择正确的 Team 类型和成员来源，不能用 organization team 成员 API 代表 enterprise team，也不能用 enterprise team 权限推断 organization team 可见性。
- **账单周期语义**：Premium Request 与未来 Token 额度均按自然月计算、下月重置。Premium Usage 不应默认使用滚动 28 天窗口；默认查询当前自然月，并支持上月、今年、去年等自然账单周期。
- **权限降级与数据最小化**：当 Team 成员 API 权限不足、team 不存在、成员为空或返回数据无法解析时，系统应返回/展示 permission、empty 或 partial 状态，并限制输出为必要诊断信息，不能回退展示未授权的全量用户用量。
- **历史语义说明**：Team 筛选基于当前团队成员关系，除非 GitHub 后续提供历史 billing attribution；页面需要避免暗示过滤结果一定等同于用量发生时的团队归属。
- **性能**：第一阶段默认加载当前 scope 的 Copilot seat 候选用户并按 usage 排序展示；Top N、延迟加载或增量加载属于后续优化，用于进一步降低大规模 enterprise 的首次加载成本。
- **缓存与性能**：Premium Usage 后端应缓存 parent enterprise 识别、Team 成员、Copilot seats、以及 per-user Premium Request usage，并按授权上下文隔离缓存。筛选或刷新同一账单周期内的相同 Team/用户集合时，不应重复触发完整 GitHub API 调用链。
- **性能与稳定性**：Team 筛选不应显著破坏现有 Premium Usage 的搜索、分页和排序体验；解析团队成员和逐用户 usage 查询需要考虑分页、限流、partial 结果和可恢复错误。
- **可用性**：视图切换、Team 筛选、Model 筛选、时间范围和数据口径需要清晰可见。
- **交互一致性**：Premium Request view 与 Token Usage view 应保持一致的用户列表、用户展开和模型明细交互，降低管理员从 request 口径迁移到 token 口径的学习成本。
- **可解释性**：Token Usage view 需要解释费用估算依赖模型 list price，且不同 token 分类可能价格不同。
- **国际化**：页面文案和指标名称应支持现有应用的多语言策略。
- **兼容性**：系统需要支持 2026-06-01 前后的过渡期：6/1 前支持 Premium Request 与 Token Usage 双视图，6/1 后支持 token-only 主视图。
- **可审计性**：报表中的时间范围、筛选条件、聚合维度和价格来源需要明确可见，便于团队对账。

## 5. 参考资料

- GitHub Docs: Monitoring your GitHub Copilot usage and entitlements - https://docs.github.com/en/copilot/how-tos/manage-and-track-spending/monitor-premium-requests#viewing-an-overview-in-your-billing-and-licensing-settings
- GitHub Docs: Enterprise team members API - https://docs.github.com/en/enterprise-cloud@latest/rest/enterprise-teams/enterprise-team-members?apiVersion=2026-03-10
- GitHub Blog: GitHub Copilot is moving to usage-based billing - https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/
- GitHub Docs: Models and pricing for GitHub Copilot - https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
- UI reference: [current-premium-request-analystics-byuser.png](current-premium-request-analystics-byuser.png)

## English Version

## 1. Background & Value

- **User Story**: As a GitHub Copilot Enterprise/Organization admin or Billing Manager, I want to view Premium Request and Token Usage analytics in Copilot Metrics Viewer, so that I can understand enterprise, team, user, and model-level consumption after GitHub Copilot moves to usage-based billing and use the data for cost review and governance.
- **Business Value**:
  - Today, admins can use GitHub.com Billing > Usage > Premium request analytics to understand premium request usage for an enterprise or organization, including filtering and grouping by user, model, organization, or cost center.
  - The current GitHub.com billing user view is centered on a user-level table: each row summarizes one user's request usage, and expanding a user row shows request counts by model. See the UI reference: [current-premium-request-analystics-byuser.png](current-premium-request-analystics-byuser.png).
  - Starting June 1, 2026, GitHub Copilot will move from premium request-based billing to usage-based billing, and premium request units will be replaced by GitHub AI Credits.
  - The new billing model will be based on token consumption, including input tokens, output tokens, cached tokens, and model-specific dimensions such as cache write where applicable. Different models have different list prices, priced per 1 million tokens.
  - Enterprises need a reporting experience in this application that bridges the current Premium Request model and the upcoming Token Usage model.
  - This capability helps teams identify high-usage users, high-cost models, team-level consumption patterns, and user-level token cost estimates for internal cost review.
  - The Premium Usage page must let admins narrow usage analysis by team so team leads, cost center owners, and Billing Managers can review premium request usage for members of a specific team.

## 2. Scope & Boundaries

- **In-Scope**:
  - Add a Premium Request Analytics / Token Usage reporting capability.
  - Support two display modes:
    - Premium Request view: show usage using a premium request-based perspective, similar to the current GitHub.com billing analytics experience.
    - Token Usage view: show usage using a token-based perspective.
  - Premium Request view should use a user-level table pattern: each user row shows request usage summary, and expanding the row shows that user's request counts by model.
  - Token Usage view should preserve the same information architecture: each user row shows token usage summary, and expanding the row shows that user's token usage details by model.
  - In the future token-only stage, the core experience should not become a completely separate page. It should keep the same user table and expandable model detail pattern while replacing request metrics with token metrics.
  - Token Usage is capability-driven in Phase 1: when GitHub returns user, model, and token-category dimensions, the report shows those details; when the concrete API or fields are unavailable, the report returns partial/unavailable state with clear limitations.
  - By default, show each user's Premium Request usage for the current calendar month because premium request quotas are calculated by billing month and reset next month.
  - By default, show each user's token usage by model for the current calendar month. Future token quotas should follow natural billing month/year query semantics.
  - Token Usage should distinguish input tokens, output tokens, cached tokens, and other relevant token billing dimensions when available from the source data; complete category coverage is not mandatory until GitHub provides stable fields.
  - Support filtering by Team. The Premium Usage page must expose a visible Team dropdown and load Enterprise Teams or Organization Teams based on the current scope.
  - Support filtering by billing timeframe. The Premium Usage page must expose a Timeframe dropdown with at least Current month, Last month, This year, and Last year. The default is Current month.
  - Team filtering must distinguish Enterprise Teams from Organization Teams:
    - When `scope=enterprise` and no organization context is selected, Team means Enterprise Team by default.
    - When `scope=organization`, Team means Organization Team.
    - When an enterprise view is narrowed to an organization context, Team may refer to an Organization Team in that organization, but the page semantics or status must avoid confusing it with an Enterprise Team.
  - Organization scope must distinguish the billing owner:
    - A standalone organization owns its Premium Request billing at the organization level and should use the organization premium request endpoint.
    - An enterprise-owned organization has Premium Request billing under its parent enterprise. The system should discover the parent enterprise visible to the current token and use the enterprise premium request endpoint for per-user usage, while keeping organization teams and organization seats as the user-candidate boundary.
    - If GitHub APIs cannot reveal the parent enterprise, or the caller cannot enumerate enterprise/organization relationships, the system must safely fall back to standalone organization billing semantics or return a clear permission/data state rather than inventing enterprise ownership.
  - Premium Usage Team filtering must resolve team membership first and then filter user-level premium request/token usage results by the resolved member set. GitHub Billing Usage/Premium Request APIs must not be assumed to support a native `team` query parameter.
  - Premium Request per-user calls must not send both `user` and `organization` to GitHub's enterprise premium request endpoint because GitHub requires callers to specify only one of those filters. Enterprise-owned organization reports should narrow users through organization team members, organization seats, and the per-user candidate set.
  - After a Team filter is applied, the existing sort, search, and pagination experience must be preserved: user rows remain sorted by the relevant usage metric descending, Premium Request view by premium request count, Token Usage view by total token count, and table search/pagination apply to the filtered user set.
  - Support filtering by Model.
  - By default, load the authorized Copilot seat users for the current scope: enterprise scope loads enterprise seats, organization scope loads organization seats, and enterprise + organization override loads that organization's seats. User rows are sorted by the relevant usage metric descending and keep table pagination.
  - Top N, lazy loading, or other first-load cost optimizations are deferred performance enhancements and are not Phase 1 acceptance requirements.
  - Support both Enterprise and Organization admin perspectives, subject to GitHub's official permission model and available data.
  - After June 1, the product should transition toward a token-only reporting experience.
  - Future reporting should estimate each user's token cost based on each model's public list price to help teams reconcile usage costs.
- **Out-of-Scope**:
  - Phase 1 does not include budget creation, budget alerts, or automatic spend caps.
  - Phase 1 does not include real billing, AI Credits purchasing, or credit balance management.
  - Phase 1 does not guarantee fields that GitHub has not exposed or that the current role cannot access.
  - Phase 1 does not include GitHub Actions minutes cost calculation for Copilot code review; this can be evaluated separately as a future enhancement.

## 3. Acceptance Criteria

- [ ] AC1: Admins can access the Premium Request Analytics / Token Usage report page.
- [ ] AC2: The report provides both Premium Request view and Token Usage view, and users can switch between them.
- [ ] AC3: By default, the page shows the authorized Copilot seat users for the current scope and current calendar month, sorted by premium request usage descending.
- [ ] AC4: Premium Request view shows at least user, time range, premium request usage, and the core summary information aligned with GitHub.com billing analytics.
- [ ] AC5: Premium Request view uses a user-level table where each user row can be expanded to show that user's request counts by model.
- [ ] AC6: Token Usage view uses the same user-level table and expandable interaction as Premium Request view, where each user row can be expanded to show that user's token usage details by model.
- [ ] AC7: When GitHub token usage data includes user and model dimensions, Token Usage view shows per-user, per-model token usage details for the selected natural billing period; otherwise it shows a partial/unavailable state.
- [ ] AC8: Token Usage view can aggregate token usage by model.
- [ ] AC9: In the token-only stage, the report replaces request-related columns and metrics with token-related columns and metrics within the same user table and expandable model detail structure.
- [ ] AC10: When token detail data is available, the report shows input tokens, output tokens, and cached tokens. If the concrete token API or any token category is unavailable, the page clearly explains that the data is unavailable instead of silently showing blanks.
- [ ] AC11: Users can filter report data by the Team dropdown on the Premium Usage page.
- [ ] AC12: When `scope=enterprise` and no organization context is selected, Team filtering uses Enterprise Teams and resolves members through the GitHub Enterprise Team members API before filtering the Premium Usage user list.
- [ ] AC13: When `scope=organization`, Team filtering uses Organization Teams and follows organization team membership semantics before filtering the Premium Usage user list.
- [ ] AC13a: When the organization is standalone, Premium Request view uses the organization billing source and supports Organization Team filtering.
- [ ] AC13b: When the organization belongs to a GitHub Enterprise, Premium Request view automatically discovers the parent enterprise, uses the enterprise billing source for per-user usage, and still uses Organization Team membership plus organization seats as the candidate-user boundary.
- [ ] AC14: The page or data state clearly distinguishes Enterprise Teams from Organization Teams so users do not assume the two team types are interchangeable or backed by the same permissions/API.
- [ ] AC15: After a Team filter is applied, Premium Request view still sorts filtered users by premium request usage descending, and Token Usage view still sorts filtered users by total token usage descending.
- [ ] AC16: After a Team filter is applied, table search, pagination, row expansion, and model details continue to work on the filtered user set and remain consistent with the existing unfiltered experience.
- [ ] AC17: If the team does not exist, has no members, or returns an unparseable membership response, the page displays a clear empty state or partial-data message instead of silently showing all users.
- [ ] AC18: If the caller can access billing usage but lacks permission to read the relevant Team membership, the page displays a clear permission message and must not leak unauthorized team members or their usage details.
- [ ] AC19: Users can filter report data by Model.
- [ ] AC20: When filters change, the current-scope user list, Premium Request data, Token Usage data, and model details update consistently.
- [ ] AC20a: Users can switch the Timeframe dropdown between Current month, Last month, This year, and Last year, and the backend maps the selection to natural month or natural year GitHub billing usage query parameters.
- [ ] AC21: The report preserves the transition semantics between Premium Requests and Token Usage so users do not assume the two metrics are directly interchangeable.
- [ ] AC22: After June 1, when the business model becomes token-only, the report can hide or de-emphasize Premium Request view and use Token Usage view as the primary experience.
- [ ] AC23: When future cost estimation is enabled, the system can estimate each user's token cost based on public model list prices.
- [ ] AC24: When data is missing, delayed, or unavailable due to role permissions, the page displays a clear empty state or permission message.

## 4. Non-Functional Requirements

- **Security**: Only authorized Enterprise Owners, Organization Admins, Billing Managers, or equivalent roles can view user-level and cost-level data.
- **Privacy**: User-level reporting must follow GitHub's official permission restrictions. Unauthorized roles must not see individual premium request or token usage details.
- **Team permission boundaries**: Enterprise Teams and Organization Teams are different objects backed by different GitHub APIs and permission models. The system must choose the correct team type and membership source for the current scope, must not use organization team membership APIs as a substitute for enterprise teams, and must not infer organization team visibility from enterprise team permissions.
- **Billing period semantics**: Premium Request and future Token quotas are calculated by calendar month and reset the next month. Premium Usage should not default to a rolling 28-day window; it should default to the current calendar month and support last month, this year, and last year natural billing periods.
- **Permission degradation and data minimization**: If the Team members API is forbidden, the team does not exist, membership is empty, or the response cannot be parsed, the system should return/display permission, empty, or partial states and limit output to necessary diagnostics. It must not fall back to showing unauthorized all-user usage.
- **Historical semantics**: Team filtering is based on current team membership unless GitHub later provides historical billing attribution. The page must not imply that filtered results always match team membership at the time usage occurred.
- **Performance**: Phase 1 loads the current-scope Copilot seat candidates by default and sorts them by usage. Top N, lazy loading, or incremental loading are deferred optimizations for reducing first-load cost in large enterprises.
- **Caching and performance**: Premium Usage backend calls should cache parent-enterprise discovery, team members, Copilot seats, and per-user Premium Request usage, with cache entries isolated by authorization context. Re-selecting or refreshing the same Team/user set in the same billing period should not repeat the full GitHub API call chain.
- **Performance and resilience**: Team filtering must not materially degrade the existing Premium Usage search, pagination, and sorting experience. Team membership resolution and per-user usage collection must account for pagination, rate limits, partial results, and recoverable upstream failures.
- **Usability**: Display mode, Team filter, Model filter, time range, and data meaning must be clear and easy to understand.
- **Interaction consistency**: Premium Request view and Token Usage view should keep a consistent user table, row expansion, and model detail interaction to reduce the learning cost when admins move from request-based reporting to token-based reporting.
- **Explainability**: Token Usage view must explain that cost estimation depends on model list prices, and different token categories may use different rates.
- **Internationalization**: Page copy and metric labels should follow the application's existing internationalization strategy.
- **Compatibility**: The system must support the transition period around June 1, 2026: dual Premium Request and Token Usage views before June 1, and token-only primary reporting after June 1.
- **Auditability**: The report must clearly show time range, filters, grouping dimensions, and pricing references so teams can reconcile usage and cost.

## 5. References

- GitHub Docs: Monitoring your GitHub Copilot usage and entitlements - https://docs.github.com/en/copilot/how-tos/manage-and-track-spending/monitor-premium-requests#viewing-an-overview-in-your-billing-and-licensing-settings
- GitHub Docs: Enterprise team members API - https://docs.github.com/en/enterprise-cloud@latest/rest/enterprise-teams/enterprise-team-members?apiVersion=2026-03-10
- GitHub Blog: GitHub Copilot is moving to usage-based billing - https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/
- GitHub Docs: Models and pricing for GitHub Copilot - https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
- UI reference: [current-premium-request-analystics-byuser.png](current-premium-request-analystics-byuser.png)
