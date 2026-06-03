<template>
  <div class="premium-usage-viewer">
    <v-card variant="outlined" class="mx-4 mt-3 mb-3 pa-3" density="compact">
      <div class="d-flex flex-wrap align-start ga-3 text-body-2">
        <div class="mr-3 flex-grow-1 premium-usage-intro">
          <div class="font-weight-bold text-body-1 mb-1">AI Usage</div>
          <div class="text-medium-emphasis">
            Billing-oriented Copilot AI Credit usage by user and model for the selected scope and period.
          </div>
        </div>
        <v-divider vertical class="mx-2 hidden-sm-and-down" />
        <div class="d-flex flex-column ga-1 flex-shrink-0">
          <div class="text-caption text-medium-emphasis font-weight-medium mb-1">SOURCE</div>
          <div class="text-body-2">{{ sourceLabel }}</div>
          <div class="text-caption text-medium-emphasis">{{ selectedTimeframeLabel }}</div>
        </div>
      </div>
    </v-card>

    <v-container fluid class="px-4">
      <v-row class="mb-3" align="center">
        <v-col cols="12" md="3">
          <v-btn-toggle v-model="viewMode" density="comfortable" variant="outlined" mandatory divided>
            <v-btn value="ai_credit" prepend-icon="mdi-counter">AI Credits</v-btn>
            <v-btn value="token_usage" prepend-icon="mdi-chart-timeline-variant">Token Usage</v-btn>
          </v-btn-toggle>
        </v-col>
        <v-col cols="12" md="2">
          <v-select
            v-model="selectedTeam"
            :items="teamFilterItems"
            :loading="teamsLoading"
            item-title="name"
            item-value="slug"
            label="Team"
            density="compact"
            variant="outlined"
            hide-details
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-select
            v-model="selectedTimeframe"
            :items="timeframeItems"
            item-title="title"
            item-value="value"
            label="Timeframe"
            density="compact"
            variant="outlined"
            hide-details
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-select
            v-model="selectedModel"
            :items="modelFilterItems"
            item-title="model"
            item-value="modelKey"
            label="Model"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-text-field
            v-model="search"
            prepend-inner-icon="mdi-magnify"
            label="Search users"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
        </v-col>
        <v-col cols="12" md="1" class="text-md-right">
          <v-btn :loading="loading" color="primary" variant="tonal" prepend-icon="mdi-refresh" @click="refreshReport">
            Refresh
          </v-btn>
        </v-col>
      </v-row>

      <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-3" closable @click:close="errorMessage = undefined">
        {{ errorMessage }}
      </v-alert>

      <v-alert v-for="message in reportMessages" :key="message" :type="report?.dataState === 'complete' ? 'info' : 'warning'" variant="tonal" class="mb-3">
        {{ message }}
      </v-alert>

      <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-3" />

      <div class="tiles-container mb-4">
        <v-card elevation="3" color="surface" variant="elevated">
          <v-card-item>
            <div class="tiles-text">
              <div class="text-h6 mb-1">Users</div>
              <div class="text-caption text-medium-emphasis">Displayed billing users</div>
              <p class="kpi-value text-primary mt-1">{{ formatNumber(report?.summary.totalUsers) }}</p>
            </div>
          </v-card-item>
        </v-card>
        <v-card elevation="3" color="surface" variant="elevated">
          <v-card-item>
            <div class="tiles-text">
              <div class="text-h6 mb-1">Included Credits</div>
              <div class="text-caption text-medium-emphasis">Credits covered by plan</div>
              <p class="kpi-value text-indigo mt-1">{{ formatCredits(report?.summary.totalIncludedCredits ?? report?.summary.totalIncludedRequests) }}</p>
            </div>
          </v-card-item>
        </v-card>
        <v-card elevation="3" color="surface" variant="elevated">
          <v-card-item>
            <div class="tiles-text">
              <div class="text-h6 mb-1">Additional Credits</div>
              <div class="text-caption text-medium-emphasis">Credits billed beyond allowance</div>
              <p class="kpi-value text-teal mt-1">{{ formatCredits(report?.summary.totalAdditionalCredits ?? report?.summary.totalBilledRequests) }}</p>
            </div>
          </v-card-item>
        </v-card>
        <v-card elevation="3" color="surface" variant="elevated">
          <v-card-item>
            <div class="tiles-text">
              <div class="text-h6 mb-1">Additional Usage</div>
              <div class="text-caption text-medium-emphasis">Net usage amount</div>
              <p class="kpi-value text-success mt-1">{{ formatCurrency(amountValue) }}</p>
            </div>
          </v-card-item>
        </v-card>
      </div>

      <v-card variant="elevated" elevation="2">
        <v-card-title class="text-subtitle-1 font-weight-medium pt-3 px-4">
          {{ tableTitle }}
        </v-card-title>
        <v-card-subtitle class="px-4 pb-2">
          {{ report?.periodStart || dateRange.since || 'latest' }} to {{ report?.periodEnd || dateRange.until || 'latest' }}
        </v-card-subtitle>
        <v-card-text class="pa-0">
          <v-data-table
            :headers="activeHeaders"
            :items="filteredUsers"
            :items-per-page="25"
            :items-per-page-options="[10, 25, 50, 100]"
            :loading="loading"
            item-value="login"
            class="elevation-0"
            density="comfortable"
          >
            <template #item="{ item }">
              <tr>
                <td>
                  <v-btn icon size="small" variant="text" :title="isExpanded(item.login) ? 'Collapse model details' : 'Expand model details'" @click="toggleExpanded(item.login)">
                    <v-icon size="18">{{ isExpanded(item.login) ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
                  </v-btn>
                </td>
                <td>
                  <div class="d-flex align-center ga-2">
                    <v-avatar v-if="item.avatarUrl" size="28"><v-img :src="item.avatarUrl" :alt="item.login" /></v-avatar>
                    <v-avatar v-else size="28"><v-icon size="18">mdi-account-circle</v-icon></v-avatar>
                    <div>
                      <div class="font-weight-medium">{{ item.login }}</div>
                      <div v-if="item.organizationLogin" class="text-caption text-medium-emphasis">{{ item.organizationLogin }}</div>
                    </div>
                  </div>
                </td>
                <td v-if="isCreditView" class="text-right">{{ formatCredits(item.includedCredits ?? item.includedRequests) }}</td>
                <td v-if="isCreditView" class="text-right">{{ formatCredits(item.additionalCredits ?? item.billedRequests) }}</td>
                <td v-if="isCreditView" class="text-right">{{ formatCurrency(item.grossAmountUsd) }}</td>
                <td v-if="isCreditView" class="text-right font-weight-medium">{{ formatCurrency(item.additionalUsageUsd ?? item.billedAmountUsd) }}</td>
                <td v-if="viewMode === 'token_usage'" class="text-right font-weight-medium">{{ formatNumber(item.totalTokens) }}</td>
                <td v-if="viewMode === 'token_usage'" class="text-right">{{ formatNumber(item.inputTokens) }}</td>
                <td v-if="viewMode === 'token_usage'" class="text-right">{{ formatNumber(item.outputTokens) }}</td>
                <td v-if="viewMode === 'token_usage'" class="text-right">{{ formatNumber(item.cachedTokens) }}</td>
                <td v-if="viewMode === 'token_usage'" class="text-right">{{ formatNumber(item.cacheWriteTokens) }}</td>
                <td v-if="viewMode === 'token_usage'" class="text-right">{{ formatCurrency(item.estimatedCostUsd) }}</td>
              </tr>
              <tr v-if="isExpanded(item.login)">
                <td />
                <td :colspan="activeHeaders.length - 1" class="model-detail-cell">
                  <v-table density="compact" class="model-detail-table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th v-for="header in modelDetailHeaders" :key="header.key" class="text-right">{{ header.title }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="model in item.models" :key="model.modelKey">
                        <td>{{ model.model }}</td>
                        <td v-for="header in modelDetailHeaders" :key="header.key" class="text-right">
                          {{ formatMetric(model, header.key) }}
                        </td>
                      </tr>
                    </tbody>
                  </v-table>
                </td>
              </tr>
            </template>
            <template #no-data>
              <v-alert type="warning" variant="tonal" class="ma-4">
                No billing usage rows are available for the selected scope, period, and filters.
              </v-alert>
            </template>
          </v-data-table>
        </v-card-text>
      </v-card>
    </v-container>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { BillingUsageModelDetail, BillingUsageReport, BillingUsageTimeframe, BillingUsageUser, BillingUsageViewMode } from '../../shared/billing-usage';

type DateRange = { since?: string; until?: string };
type Header = { title: string; key: string; sortable?: boolean; width?: string };
type TeamOption = { name: string; slug: string; description?: string };

const ALL_TEAMS_VALUE = '__all__';

export default defineComponent({
  name: 'PremiumUsageViewer',
  props: {
    dateRangeDescription: {
      type: String,
      default: 'Over the last 28 days',
    },
    dateRange: {
      type: Object as PropType<DateRange>,
      default: () => ({}),
    },
    queryParams: {
      type: Object as PropType<Record<string, string>>,
      default: () => ({}),
    },
  },
  data() {
    return {
      viewMode: 'ai_credit' as BillingUsageViewMode,
      selectedTeam: undefined as string | undefined,
      teams: [] as TeamOption[],
      teamsLoading: false,
      selectedTimeframe: 'current_month' as BillingUsageTimeframe,
      selectedModel: undefined as string | undefined,
      search: '',
      expandedUserKeys: [] as string[],
      loading: false,
      errorMessage: undefined as string | undefined,
      rawReport: undefined as BillingUsageReport | undefined,
      lastReportRequestKey: '',
    };
  },
  computed: {
    // Compute a derived report with model-filtered summary so template bindings stay unchanged.
    // This avoids re-fetching from the backend when only the model filter changes.
    report(): BillingUsageReport | undefined {
      if (!this.rawReport) return undefined;
      return { ...this.rawReport, summary: this.computedSummary ?? this.rawReport.summary };
    },
    // Per-user list after applying the model filter (client-side). Search filter is applied on top in filteredUsers.
    modelFilteredUsers(): BillingUsageUser[] {
      const users = this.rawReport?.users ?? [];
      const modelKey = this.selectedModel;
      if (!modelKey) return users;

      return users
        .map((user) => {
          const matching = user.models.filter((m) => m.modelKey === modelKey);
          if (matching.length === 0) return null;
          const sum = (fn: (m: import('../../shared/billing-usage').BillingUsageModelDetail) => number | undefined) =>
            matching.reduce((acc, m) => acc + (fn(m) ?? 0), 0);
          return {
            ...user,
            models: matching,
            aiCredits: sum((m) => m.aiCredits),
            includedCredits: sum((m) => m.includedCredits),
            additionalCredits: sum((m) => m.additionalCredits),
            premiumRequests: sum((m) => m.premiumRequests),
            includedRequests: sum((m) => m.includedRequests),
            billedRequests: sum((m) => m.billedRequests),
            grossAmountUsd: sum((m) => m.grossAmountUsd),
            additionalUsageUsd: sum((m) => m.additionalUsageUsd),
            billedAmountUsd: sum((m) => m.billedAmountUsd),
            totalTokens: sum((m) => m.totalTokens),
            inputTokens: sum((m) => m.inputTokens),
            outputTokens: sum((m) => m.outputTokens),
            cachedTokens: sum((m) => m.cachedTokens),
            cacheWriteTokens: sum((m) => m.cacheWriteTokens),
            estimatedCostUsd: sum((m) => m.estimatedCostUsd),
          } as BillingUsageUser;
        })
        .filter((user): user is BillingUsageUser => user !== null);
    },
    // Summary computed from the model-filtered user list.
    computedSummary(): import('../../shared/billing-usage').BillingUsageSummary | undefined {
      if (!this.rawReport) return undefined;
      if (!this.selectedModel) return this.rawReport.summary;
      const users = this.modelFilteredUsers;
      const sum = (fn: (u: BillingUsageUser) => number | undefined) =>
        users.reduce((acc, u) => acc + (fn(u) ?? 0), 0);
      return {
        totalUsers: users.length,
        totalAiCredits: sum((u) => u.aiCredits ?? u.premiumRequests),
        totalIncludedCredits: sum((u) => u.includedCredits ?? u.includedRequests),
        totalAdditionalCredits: sum((u) => u.additionalCredits ?? u.billedRequests),
        totalPremiumRequests: sum((u) => u.premiumRequests),
        totalIncludedRequests: sum((u) => u.includedRequests),
        totalBilledRequests: sum((u) => u.billedRequests),
        totalTokens: sum((u) => u.totalTokens),
        totalInputTokens: sum((u) => u.inputTokens),
        totalOutputTokens: sum((u) => u.outputTokens),
        totalCachedTokens: sum((u) => u.cachedTokens),
        totalCacheWriteTokens: sum((u) => u.cacheWriteTokens),
        grossAmountUsd: sum((u) => u.grossAmountUsd),
        additionalUsageUsd: sum((u) => u.additionalUsageUsd ?? u.billedAmountUsd),
        billedAmountUsd: sum((u) => u.billedAmountUsd),
        estimatedCostUsd: sum((u) => u.estimatedCostUsd),
      };
    },
    sourceLabel(): string {
      if (!this.rawReport?.sourceApi) return 'Not loaded';
      return this.rawReport.sourceApi.replaceAll('_', ' ');
    },
    timeframeItems(): Array<{ title: string; value: BillingUsageTimeframe }> {
      const now = new Date();
      return [
        { title: 'Current month', value: 'current_month' },
        { title: 'Last month', value: 'last_month' },
        { title: `This year (${now.getFullYear()})`, value: 'this_year' },
        { title: `Last year (${now.getFullYear() - 1})`, value: 'last_year' },
      ];
    },
    selectedTimeframeLabel(): string {
      return this.timeframeItems.find((item) => item.value === this.selectedTimeframe)?.title ?? this.dateRangeDescription;
    },
    teamFilterItems(): TeamOption[] {
      return [{ name: 'All teams', slug: ALL_TEAMS_VALUE }, ...this.teams];
    },
    reportMessages(): string[] {
      if (!this.rawReport) return [];
      const messages = [...this.rawReport.messages];
      if (this.rawReport.teamFilterWarning) messages.push(this.rawReport.teamFilterWarning);
      return messages;
    },
    amountValue(): number | undefined {
      const summary = this.computedSummary;
      return summary?.additionalUsageUsd ?? summary?.billedAmountUsd ?? summary?.estimatedCostUsd ?? summary?.grossAmountUsd;
    },
    modelFilterItems(): Array<{ model: string; modelKey: string }> {
      return this.rawReport?.modelOptions ?? [];
    },
    tableTitle(): string {
      return this.viewMode === 'ai_credit' || this.viewMode === 'premium_request' ? 'AI Credit Usage by User' : 'Token Usage by User';
    },
    isCreditView(): boolean {
      return this.viewMode === 'ai_credit' || this.viewMode === 'premium_request';
    },
    activeHeaders(): Header[] {
      const base: Header[] = [
        { title: '', key: 'expand', sortable: false, width: '56px' },
        { title: 'User', key: 'login' },
      ];
      if (this.viewMode === 'ai_credit' || this.viewMode === 'premium_request') {
        return [
          ...base,
          { title: 'Included Credits', key: 'includedCredits' },
          { title: 'Additional Credits', key: 'additionalCredits' },
          { title: 'Gross Amount', key: 'grossAmountUsd' },
          { title: 'Additional Usage', key: 'additionalUsageUsd' },
        ];
      }
      return [
        ...base,
        { title: 'Total Tokens', key: 'totalTokens' },
        { title: 'Input', key: 'inputTokens' },
        { title: 'Output', key: 'outputTokens' },
        { title: 'Cached', key: 'cachedTokens' },
        { title: 'Cache Write', key: 'cacheWriteTokens' },
        { title: 'Estimated Cost', key: 'estimatedCostUsd' },
      ];
    },
    modelDetailHeaders(): Header[] {
      return this.activeHeaders.slice(2);
    },
    filteredUsers(): BillingUsageUser[] {
      const users = this.modelFilteredUsers;
      const search = this.search.trim().toLowerCase();
      if (!search) return users;
      return users.filter((user) => user.login.toLowerCase().includes(search));
    },
  },
  watch: {
    viewMode() {
      this.selectedModel = undefined;
      this.expandedUserKeys = [];
      this.fetchReport();
    },
    // Model filtering is applied client-side from cached rawReport; no backend call needed.
    selectedModel() {
      this.expandedUserKeys = [];
    },
    selectedTeam() {
      this.expandedUserKeys = [];
      this.fetchReport();
    },
    selectedTimeframe() {
      this.expandedUserKeys = [];
      this.fetchReport();
    },
    queryParams: {
      deep: true,
      handler() {
        this.syncSelectedTeamFromQuery();
        this.fetchTeams();
        this.fetchReport();
      },
    },
  },
  mounted() {
    this.syncSelectedTeamFromQuery();
    this.fetchTeams();
    this.fetchReport();
  },
  methods: {
    normalizeTeamSelection(value?: string) {
      const selected = value?.trim();
      if (!selected || selected === ALL_TEAMS_VALUE || selected.toLowerCase() === 'all teams') return undefined;
      return selected;
    },
    syncSelectedTeamFromQuery() {
      this.selectedTeam = this.normalizeTeamSelection(this.queryParams.githubTeam) ?? ALL_TEAMS_VALUE;
    },
    async fetchTeams() {
      this.teamsLoading = true;
      try {
        const params = new URLSearchParams({ ...this.queryParams });
        params.delete('githubTeam');
        params.delete('since');
        params.delete('until');
        const teams = await $fetch<TeamOption[]>(`/api/teams?${params.toString()}`);
        this.teams = teams;
      } catch {
        this.teams = [];
      } finally {
        this.teamsLoading = false;
      }
    },
    buildReportParams() {
      const params = new URLSearchParams({
        ...this.queryParams,
        viewMode: this.viewMode,
        timeframe: this.selectedTimeframe,
      });
      if (this.viewMode === 'ai_credit' || this.viewMode === 'premium_request') params.set('sourceApi', 'ai_credit_usage');
      else params.delete('sourceApi');
      params.delete('since');
      params.delete('until');
      const selectedTeam = this.normalizeTeamSelection(this.selectedTeam);
      if (selectedTeam) params.set('githubTeam', selectedTeam);
      else params.delete('githubTeam');
      return params;
    },
    refreshReport() {
      this.fetchReport(true);
    },
    async fetchReport(force = false) {
      const params = this.buildReportParams();
      const requestKey = params.toString();
      if (!force && this.rawReport && requestKey === this.lastReportRequestKey) return;

      this.loading = true;
      this.errorMessage = undefined;
      try {
        // Model filtering is applied client-side; do not pass model to backend.
        // This allows the rawReport to be reused across model filter changes.
        const response = await $fetch<BillingUsageReport>(`/api/billing-usage?${params.toString()}`);
        this.rawReport = response;
        this.lastReportRequestKey = requestKey;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.errorMessage = message || 'Failed to load billing usage data.';
      } finally {
        this.loading = false;
      }
    },
    toggleExpanded(login: string) {
      if (this.expandedUserKeys.includes(login)) {
        this.expandedUserKeys = this.expandedUserKeys.filter((item) => item !== login);
        return;
      }
      this.expandedUserKeys = [...this.expandedUserKeys, login];
    },
    isExpanded(login: string): boolean {
      return this.expandedUserKeys.includes(login);
    },
    formatMetric(item: BillingUsageModelDetail, key: string): string {
      const value = item[key as keyof BillingUsageModelDetail];
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.includes('amount') || normalizedKey.includes('cost') || normalizedKey.includes('usd')) return this.formatCurrency(value as number | undefined);
      if (normalizedKey.includes('credit')) return this.formatCredits(value as number | undefined);
      return this.formatNumber(value as number | undefined);
    },
    formatCredits(value?: number): string {
      if (value === undefined || value === null) return '-';
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value);
    },
    formatNumber(value?: number): string {
      if (value === undefined || value === null) return '-';
      return Math.round(value).toLocaleString();
    },
    formatCurrency(value?: number): string {
      if (value === undefined || value === null) return '-';
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
    },
  },
});
</script>

<style scoped>
.premium-usage-intro {
  min-width: 260px;
}

.model-detail-cell {
  background: rgba(var(--v-theme-primary), 0.04);
  padding: 12px 16px !important;
}

.model-detail-table {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>