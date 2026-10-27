<script setup lang="ts">
useHead({ title: 'Insights' })
const route = useRoute()
const router = useRouter()

const range = computed<InsightRange>(() => isInsightRange(route.query.range) ? route.query.range : '12m')
const span = computed(() => rangeMonths(range.value))
const setRange = (v: string | number) => router.replace({ query: { ...route.query, range: v === '12m' ? undefined : String(v) } })
// The mortgage would top every list, so bills paid straight to the bank start hidden.
const hideDirect = ref(true)

const { data: current, status } = await useFetch('/api/insights', { query: computed(() => ({ from: span.value.from, to: span.value.to })), default: () => [] })
const { data: previous } = await useFetch('/api/insights', { query: computed(() => ({ from: span.value.prevFrom, to: span.value.prevTo })), default: () => [] })
const { data: directPay } = await useFetch('/api/settings/direct-pay', { default: () => [] as string[] })

const visible = (list: InsightBill[]) => {
  const direct = new Set(directPay.value.map(n => n.toLowerCase()))
  return hideDirect.value ? list.filter(b => !direct.has(b.name.toLowerCase())) : list
}
const bills = computed(() => visible(current.value))
const sum = (list: InsightBill[]) => list.reduce((s, b) => s + b.amountCents, 0)
const total = computed(() => sum(bills.value))
const prevTotal = computed(() => sum(visible(previous.value)))
const months = computed(() => monthlyTotals(bills.value, span.value.months))
const biggest = computed(() => months.value.reduce((a, b) => b.cents > a.cents ? b : a, months.value[0]!))
const stores = computed(() => storeTotals(bills.value).slice(0, 10))
const topCharges = computed(() => [...bills.value].sort((a, b) => b.amountCents - a.amountCents).slice(0, 10))

const periodLabel = computed(() => INSIGHT_RANGES.find(r => r.value === range.value)!.label.toLowerCase())
const change = computed(() => {
  if (!prevTotal.value) return ''
  const diff = total.value - prevTotal.value
  const pct = Math.round(Math.abs(diff) / prevTotal.value * 100)
  return `${diff >= 0 ? '+' : '−'}${formatMoney(Math.abs(diff))} (${pct}%) vs previous ${range.value === 'lastyear' ? 'year' : periodLabel.value}`
})

const stats = computed(() => [
  { title: 'Total Spent', icon: 'i-lucide-receipt-text', value: formatMoney(total.value), note: change.value },
  { title: 'Monthly Average', icon: 'i-lucide-calendar-range', value: formatMoney(Math.round(total.value / months.value.length)), note: `Over ${months.value.length} month${months.value.length === 1 ? '' : 's'}` },
  { title: 'Biggest Month', icon: 'i-lucide-trending-up', value: formatMoney(biggest.value.cents), note: monthLabel(biggest.value.month), to: { path: '/', query: { month: biggest.value.month } } },
  { title: 'Bills', icon: 'i-lucide-list', value: String(bills.value.length), note: bills.value.length ? `${formatMoney(Math.round(total.value / bills.value.length))} on average` : '' }
])

const chartData = computed(() => months.value.map(m => ({ month: m.month, label: monthLabel(m.month).replace(/^(\w{3})\w* (\d{2})(\d{2})$/, '$1 \'$3'), amount: m.cents / 100 })))
const openMonth = (month: string) => router.push({ path: '/', query: { month } })
</script>

<template>
  <div class="space-y-8">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold text-highlighted">
          Insights
        </h1>
        <p class="text-sm text-muted">
          Spending across all bills, {{ monthLabel(span.from) }} to {{ monthLabel(span.to) }}.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-4 max-w-full min-w-0">
        <USwitch v-model="hideDirect" label="Hide paid directly" />
        <div class="max-w-full overflow-x-auto">
          <UTabs
            :model-value="range"
            :items="INSIGHT_RANGES.map(r => ({ label: r.label, value: r.value }))"
            :content="false"
            class="w-fit"
            variant="pill"
            color="neutral"
            :ui="{ list: 'bg-transparent p-0 gap-1', trigger: 'rounded-full px-3.5 py-1.5 font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none before:hidden', indicator: 'hidden' }"
            @update:model-value="setRange"
          />
        </div>
      </div>
    </div>

    <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      <component
        :is="stat.to ? 'NuxtLink' : 'div'"
        v-for="stat in stats"
        :key="stat.title"
        :to="stat.to"
        class="surface-card flex items-center gap-4 px-6 py-5"
        :class="stat.to && 'transition hover:ring-2 hover:ring-primary/30'"
      >
        <div class="icon-tile">
          <UIcon :name="stat.icon" class="size-5" />
        </div>
        <div class="min-w-0">
          <div class="text-sm font-medium text-toned">
            {{ stat.title }}
          </div>
          <div class="text-[1.625rem] leading-tight font-bold text-highlighted tabular-nums">
            {{ stat.value }}
          </div>
          <div v-if="stat.note" class="text-xs font-medium text-primary mt-0.5">
            {{ stat.note }}
          </div>
        </div>
      </component>
    </div>

    <div class="surface-card p-5 space-y-3 min-w-0">
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="font-semibold text-highlighted">
          Monthly Totals
        </h2>
        <span class="text-xs text-muted">Click a bar to open that month</span>
      </div>
      <UChart
        type="bar"
        :data="chartData"
        index="label"
        :categories="[{ key: 'amount', label: 'Spent' }]"
        :format="v => formatMoney(Math.round(v * 100))"
        :height="260"
        aria-label="Spending per month"
        @select="p => p && openMonth(chartData[p.datumIndex]!.month)"
      />
    </div>

    <div class="grid gap-5 lg:grid-cols-2">
      <div class="surface-card p-5 space-y-3 min-w-0">
        <h2 class="font-semibold text-highlighted">
          Top 10 Stores
        </h2>
        <p v-if="!stores.length && status !== 'pending'" class="text-sm text-muted">
          No bills in this range.
        </p>
        <ol class="space-y-1">
          <li v-for="(s, i) in stores" :key="s.key">
            <NuxtLink :to="{ path: '/search', query: { q: s.label } }" class="block rounded-lg px-2 py-2 -mx-2 hover:bg-elevated/60 transition">
              <div class="flex items-baseline justify-between gap-3 text-sm">
                <span class="min-w-0 truncate">
                  <span class="text-muted tabular-nums me-2">{{ i + 1 }}</span>
                  <b class="text-highlighted">{{ s.label }}</b>
                  <span class="text-muted"> · {{ s.visits }} bill{{ s.visits === 1 ? '' : 's' }}</span>
                </span>
                <span class="font-semibold tabular-nums">{{ formatMoney(s.cents) }}</span>
              </div>
              <div class="mt-1.5 h-1.5 rounded-full bg-elevated overflow-hidden">
                <div class="h-full rounded-full bg-primary/70" :style="{ width: `${Math.max(2, s.cents / stores[0]!.cents * 100)}%` }" />
              </div>
            </NuxtLink>
          </li>
        </ol>
      </div>

      <div class="surface-card p-5 space-y-3 min-w-0">
        <h2 class="font-semibold text-highlighted">
          Top 10 Charges
        </h2>
        <p v-if="!topCharges.length && status !== 'pending'" class="text-sm text-muted">
          No bills in this range.
        </p>
        <ol class="divide-y divide-default">
          <li v-for="(b, i) in topCharges" :key="b.id">
            <NuxtLink :to="{ path: '/', query: { month: b.addedOn.slice(0, 7) } }" class="flex items-baseline justify-between gap-3 py-2 text-sm hover:text-primary transition">
              <span class="min-w-0 truncate">
                <span class="text-muted tabular-nums me-2">{{ i + 1 }}</span>
                <b class="text-highlighted">{{ b.name }}</b>
                <span class="text-muted"> · {{ usDotDate(b.addedOn) }}</span>
              </span>
              <span class="font-semibold tabular-nums">{{ formatMoney(b.amountCents) }}</span>
            </NuxtLink>
          </li>
        </ol>
      </div>
    </div>
  </div>
</template>
