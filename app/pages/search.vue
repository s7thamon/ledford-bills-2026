<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const route = useRoute()
const router = useRouter()
const q = computed(() => String(route.query.q ?? ''))
useHead({ title: () => q.value ? `Search: ${q.value}` : 'Search' })

const { user } = useUserSession()
const { data: users } = await useFetch('/api/users', { key: 'users', default: () => [] })
const { data: results, status } = await useFetch('/api/bills/search', { key: 'search', query: computed(() => ({ q: q.value })), default: () => [] })
type Bill = (typeof results.value)[number]

const share = (bill: Bill) => isCustomSplit(bill.participants.map(p => p.amountCents))
  ? bill.participants.find(p => p.userId === user.value?.id)?.amountCents ?? 0
  : equalShare(bill.amountCents, users.value.length)

// Filters live in the URL so a filtered search can be bookmarked or shared.
const rangeItems = [{ label: 'All Time', value: 'all' }, ...INSIGHT_RANGES.map(r => ({ label: r.label, value: r.value as string }))]
const range = computed(() => isInsightRange(route.query.range) ? route.query.range : 'all')
const minAmount = ref(String(route.query.min ?? ''))
const maxAmount = ref(String(route.query.max ?? ''))
watch([minAmount, maxAmount], ([min, max]) => router.replace({ query: { ...route.query, min: min || undefined, max: max || undefined } }))
const setRange = (v: unknown) => router.replace({ query: { ...route.query, range: v === 'all' ? undefined : String(v) } })

const inRange = computed(() => {
  const months = range.value === 'all' ? null : new Set(rangeMonths(range.value).months)
  const min = parseAmount(minAmount.value)
  const max = parseAmount(maxAmount.value)
  return results.value.filter(b => (!months || months.has(b.addedOn.slice(0, 7))) && b.amountCents >= min && (!max || b.amountCents <= max))
})
// Names picked in By Name narrow everything else on the page; none picked shows them all.
const pickedNames = ref<string[]>([])
watch(q, () => (pickedNames.value = []))
const togglePicked = (name: string) => (pickedNames.value = pickedNames.value.includes(name) ? pickedNames.value.filter(n => n !== name) : [...pickedNames.value, name])
const filtered = computed(() => pickedNames.value.length ? inRange.value.filter(b => pickedNames.value.includes(b.name)) : inRange.value)

const total = computed(() => filtered.value.reduce((s, b) => s + b.amountCents, 0))
const lastVisit = computed(() => filtered.value[0]?.addedOn)
const daysAgo = (iso: string) => Math.round((Date.parse(todayIso()) - Date.parse(iso)) / 86_400_000)
const stats = computed(() => {
  const n = filtered.value.length
  const gap = daysBetweenVisits(filtered.value)
  return [
    { title: 'Total', icon: 'i-lucide-receipt-text', value: formatMoney(total.value), note: `${n} bill${n === 1 ? '' : 's'}` },
    { title: 'Average', icon: 'i-lucide-divide', value: formatMoney(n ? Math.round(total.value / n) : 0), note: n ? `${formatMoney(Math.min(...filtered.value.map(b => b.amountCents)))} to ${formatMoney(Math.max(...filtered.value.map(b => b.amountCents)))}` : '' },
    { title: 'How Often', icon: 'i-lucide-repeat', value: gap === null ? '—' : gap === 0 ? 'Same day' : `Every ${gap} day${gap === 1 ? '' : 's'}`, note: gap === null ? '' : 'On average' },
    { title: 'Last Bill', icon: 'i-lucide-calendar-check', value: lastVisit.value ? usDotDate(lastVisit.value) : '—', note: lastVisit.value ? (daysAgo(lastVisit.value) === 0 ? 'Today' : `${daysAgo(lastVisit.value)} days ago`) : '' }
  ]
})

// Monthly bars from the first to the last month in view, empty months included.
const chartData = computed(() => {
  if (!filtered.value.length) return []
  const months = range.value === 'all'
    ? monthsBetween(filtered.value.at(-1)!.addedOn.slice(0, 7), filtered.value[0]!.addedOn.slice(0, 7))
    : rangeMonths(range.value).months
  const bars = monthlyTotals(filtered.value, months)
  // Past two years, monthly bars get too thin to read, so show one bar per year.
  if (bars.length > 24) {
    const years = new Map<string, number>()
    for (const m of bars) years.set(m.month.slice(0, 4), (years.get(m.month.slice(0, 4)) ?? 0) + m.cents)
    return [...years].map(([year, cents]) => ({ month: '', label: year, amount: cents / 100 }))
  }
  return bars.map(m => ({ month: m.month, label: monthLabel(m.month).replace(/^(\w{3})\w* (\d{2})(\d{2})$/, '$1 \'$3'), amount: m.cents / 100 }))
})
// Only worth showing when the search spans more than one name, e.g. "Costco - Blanket" and "Costco - Meds".
const variants = computed(() => storeTotals(inRange.value).flatMap(s => s.variants).sort((a, b) => b.cents - a.cents))

const columns: TableColumn<Bill>[] = [
  { accessorKey: 'addedOn', header: 'Added', meta: { class: { td: 'order-4 max-md:text-xs' } } },
  { accessorKey: 'name', header: 'Name', meta: { class: { td: 'order-1 max-md:flex-1' } } },
  { accessorKey: 'amountCents', header: 'Amount', meta: { class: { th: 'text-right', td: 'text-right order-2' } } },
  { id: 'share', header: 'Each', meta: { class: { th: 'text-right', td: 'text-right order-5 max-md:text-xs' }, style: { td: { '--label': '"Each"' } } } },
  { id: 'status', header: 'Status', meta: { class: { th: 'text-center', td: 'text-center order-7' } } }
]
</script>

<template>
  <div class="space-y-8">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold text-highlighted">
          {{ q ? `Results for "${q}"` : 'Search Bills' }}
        </h1>
        <p v-if="!q" class="text-sm text-muted">
          Use the search box in the header to find bills by name.
        </p>
      </div>
      <div v-if="q" class="flex flex-wrap items-center gap-3">
        <USelect :model-value="range" :items="rangeItems" class="w-36" aria-label="Date range" @update:model-value="setRange" />
        <UInput v-model="minAmount" icon="i-lucide-dollar-sign" placeholder="Min" aria-label="Minimum amount" inputmode="decimal" class="w-28" />
        <UInput v-model="maxAmount" icon="i-lucide-dollar-sign" placeholder="Max" aria-label="Maximum amount" inputmode="decimal" class="w-28" />
      </div>
    </div>

    <div v-if="q" class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="stat in stats" :key="stat.title" class="surface-card flex items-center gap-4 px-6 py-5">
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
      </div>
    </div>

    <div v-if="q && (chartData.length > 1 || variants.length > 1)" class="grid gap-5" :class="variants.length > 1 && chartData.length > 1 && 'lg:grid-cols-3'">
      <div v-if="chartData.length > 1" class="surface-card p-5 space-y-3 lg:col-span-2">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="font-semibold text-highlighted">
            {{ chartData[0]?.month ? 'Per Month' : 'Per Year' }}
          </h2>
          <span v-if="chartData[0]?.month" class="text-xs text-muted">Click a bar to open that month</span>
        </div>
        <UChart
          type="bar"
          :data="chartData"
          index="label"
          :categories="[{ key: 'amount', label: 'Spent' }]"
          :format="v => formatMoney(Math.round(v * 100))"
          :height="240"
          aria-label="Spending per month"
          @select="p => p && chartData[p.datumIndex]?.month && router.push({ path: '/', query: { month: chartData[p.datumIndex]!.month } })"
        />
      </div>
      <div v-if="variants.length > 1" class="surface-card p-5 space-y-3 min-w-0">
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-semibold text-highlighted">
            By Name
          </h2>
          <UButton v-if="pickedNames.length" size="xs" color="neutral" variant="soft" class="rounded-full" icon="i-lucide-x" @click="pickedNames = []">
            Clear {{ pickedNames.length }}
          </UButton>
          <span v-else class="text-xs text-muted">Click names to narrow the page</span>
        </div>
        <ul class="space-y-0.5">
          <li v-for="v in variants" :key="v.name">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 -mx-2 text-left text-sm transition"
              :class="pickedNames.includes(v.name) ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-elevated/60'"
              :aria-pressed="pickedNames.includes(v.name)"
              @click="togglePicked(v.name)"
            >
              <span class="flex min-w-0 items-center gap-2">
                <UIcon :name="pickedNames.includes(v.name) ? 'i-lucide-square-check' : 'i-lucide-square'" class="size-4 shrink-0" :class="pickedNames.includes(v.name) ? 'text-primary' : 'text-muted'" />
                <span class="truncate"><b class="text-highlighted">{{ v.name }}</b><span class="text-muted"> · {{ v.visits }}</span></span>
              </span>
              <span class="font-semibold tabular-nums">{{ formatMoney(v.cents) }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <div v-if="q" class="surface-card overflow-hidden">
      <UTable class="stack-table" :data="filtered" :columns="columns" :loading="status === 'pending'" empty="No bills match.">
        <template #addedOn-cell="{ row }">
          <NuxtLink :to="{ path: '/', query: { month: row.original.addedOn.slice(0, 7) } }" class="tabular-nums text-muted hover:text-primary">
            {{ dotDate(row.original.addedOn) }}
          </NuxtLink>
        </template>
        <template #name-cell="{ row }">
          <span class="font-semibold text-highlighted">{{ row.original.name }}</span>
          <UTooltip v-if="row.original.refunds.length" :text="row.original.refunds.map(r => `Refunded ${formatMoney(r.amountCents)} on ${usDotDate(r.refundedOn)}`).join(' · ')" :delay-duration="0" :content="{ side: 'top' }">
            <UBadge color="error" variant="soft" class="ms-2 align-middle">
              ↩ Refunded −{{ formatMoney(row.original.refunds.reduce((s, r) => s + r.amountCents, 0)) }}
            </UBadge>
          </UTooltip>
          <UTooltip v-if="row.original.credit" :text="`Credit from ${row.original.credit.sourceName}, refunded ${usDotDate(row.original.credit.refundedOn)}`" :delay-duration="0" :content="{ side: 'top' }">
            <UBadge color="secondary" variant="soft" class="ms-2 align-middle">
              ◎ −{{ formatMoney(row.original.credit.amountCents) }} credit
            </UBadge>
          </UTooltip>
        </template>
        <template #amountCents-cell="{ row }">
          <span class="tabular-nums">{{ formatMoney(row.original.amountCents) }}</span>
        </template>
        <template #share-cell="{ row }">
          <span class="inline-flex items-center gap-1 tabular-nums">
            <UIcon v-if="isCustomSplit(row.original.participants.map(p => p.amountCents))" name="i-lucide-arrow-left-right" class="size-3.5 text-muted" />
            {{ formatMoney(share(row.original)) }}
          </span>
        </template>
        <template #status-cell="{ row }">
          <UBadge v-if="row.original.cardPaidAt" color="success" variant="soft" size="md" icon="i-lucide-check">
            Settled
          </UBadge>
          <UBadge v-else-if="row.original.paidByCheck && allParticipantsPaid(row.original)" color="success" variant="soft" size="md" icon="i-lucide-file-pen-line">
            Check
          </UBadge>
          <UBadge v-else-if="row.original.paidWithCardOf" color="neutral" variant="soft" size="md" icon="i-lucide-wallet">
          Personal card
        </UBadge>
        <UBadge v-else-if="allParticipantsPaid(row.original)" color="primary" variant="soft" size="md">
            Card due
          </UBadge>
          <UBadge v-else color="warning" variant="soft" size="md">
            Unpaid
          </UBadge>
        </template>
      </UTable>
    </div>
  </div>
</template>
