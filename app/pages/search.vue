<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const route = useRoute()
const q = computed(() => String(route.query.q ?? ''))
useHead({ title: () => q.value ? `Search: ${q.value}` : 'Search' })

const { user } = useUserSession()
const { data: users } = await useFetch('/api/users', { key: 'users', default: () => [] })
const { data: results, status } = await useFetch('/api/bills/search', { key: 'search', query: computed(() => ({ q: q.value })), default: () => [] })
type Bill = (typeof results.value)[number]

const share = (bill: Bill) => isCustomSplit(bill.participants.map(p => p.amountCents))
  ? bill.participants.find(p => p.userId === user.value?.id)?.amountCents ?? 0
  : equalShare(bill.amountCents, users.value.length)

const chartData = computed(() => [...results.value].reverse().map(b => ({ date: dotDate(b.addedOn), amount: b.amountCents / 100 })))
const average = computed(() => results.value.length ? Math.round(results.value.reduce((s, b) => s + b.amountCents, 0) / results.value.length) : 0)

const columns: TableColumn<Bill>[] = [
  { accessorKey: 'addedOn', header: 'Added' },
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'amountCents', header: 'Amount', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'share', header: 'Each', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'status', header: 'Status', meta: { class: { th: 'text-center', td: 'text-center' } } }
]
</script>

<template>
  <div class="space-y-8">
    <div>
      <h1 class="text-2xl font-semibold text-highlighted">
        {{ q ? `Results for "${q}"` : 'Search Bills' }}
      </h1>
      <p v-if="q" class="text-sm text-muted">
        {{ results.length }} bill{{ results.length === 1 ? '' : 's' }}<template v-if="results.length">, averaging {{ formatMoney(average) }}</template>
      </p>
      <p v-else class="text-sm text-muted">
        Use the search box in the header to find bills by name.
      </p>
    </div>

    <div v-if="chartData.length > 1" class="surface-card p-5">
      <UChart
        type="line"
        :data="chartData"
        index="date"
        :categories="[{ key: 'amount', label: 'Amount' }]"
        :format="v => formatMoney(Math.round(v * 100))"
        :height="260"
        points
        curve="monotone"
        aria-label="Bill amount over time"
      />
    </div>

    <div v-if="q" class="surface-card overflow-hidden">
      <UTable :data="results" :columns="columns" :loading="status === 'pending'" empty="No bills match.">
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
