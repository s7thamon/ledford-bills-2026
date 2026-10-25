<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const route = useRoute()
const router = useRouter()
const run = useApi()
const toast = useToast()
const { user, session } = useUserSession()

const month = computed(() => isMonth(route.query.month) ? route.query.month : currentMonth())
// Old filter links (?userUnpaid=1 / ?cardUnpaid=1) still land on the matching tab.
// Matches the 12 months the History menu offers.
const canGoBack = computed(() => month.value > shiftMonth(currentMonth(), -12))
const tab = computed<BillTab>(() => isBillTab(route.query.tab)
  ? route.query.tab
  : route.query.userUnpaid === '1' ? 'mine' : route.query.cardUnpaid === '1' ? 'card' : 'all')
useHead({ title: () => monthLabel(month.value) })

const me = computed(() => user.value!.id)
const myName = computed(() => user.value!.name.split(' ')[0])
const adminMode = computed(() => !!session.value?.adminMode)

const { data: users } = await useFetch('/api/users', { key: 'users', default: () => [] })
const { data: bills, refresh, status } = await useFetch('/api/bills', {
  key: 'bills',
  query: computed(() => ({ month: month.value })),
  default: () => []
})
const prevMonth = computed(() => shiftMonth(month.value, -1))
const { data: prevBills, refresh: refreshPrev } = await useFetch('/api/bills', {
  key: 'bills-prev',
  query: computed(() => ({ month: prevMonth.value })),
  default: () => []
})
// Live updates only refresh the 'bills' key; follow it so last month's total stays current.
watch(bills, () => refreshPrev())
const { data: suggestions, refresh: refreshSuggestions } = await useFetch('/api/bills/suggestions', { key: 'bill-suggestions', default: () => [] })

type Bill = (typeof bills.value)[number]

// Selection
const selected = ref<number[]>([])
watch(month, () => (selected.value = []))
const hasSelection = computed(() => selected.value.length > 0)
const selectedBills = computed(() => bills.value.filter(b => selected.value.includes(b.id)))
function toggleSelected(id: number) {
  selected.value = selected.value.includes(id) ? selected.value.filter(x => x !== id) : [...selected.value, id]
}

function setTab(t: string | number) {
  router.replace({ query: { ...route.query, userUnpaid: undefined, cardUnpaid: undefined, tab: t === 'all' ? undefined : String(t) } })
}
const counts = computed(() => tabCounts(bills.value, me.value))
const partnerName = computed(() => users.value.find(u => u.id !== me.value)?.name.split(' ')[0] ?? 'Partner')
const tabItems = computed(() => [
  { label: 'All', value: 'all', badge: counts.value.all },
  { label: `${myName.value} Unpaid`, value: 'mine', badge: counts.value.mine },
  { label: `${partnerName.value} Unpaid`, value: 'theirs', badge: counts.value.theirs },
  { label: 'Card Unpaid', value: 'card', badge: counts.value.card },
  { label: 'Ready for Card', value: 'ready', badge: counts.value.ready }
].map(item => ({ ...item, badge: { label: String(item.badge), size: 'sm' as const, color: (tab.value === item.value ? 'primary' : 'neutral') as 'primary' | 'neutral', variant: 'soft' as const } })))

// Amounts
const share = (bill: Bill) => isCustomSplit(bill.participants.map(p => p.amountCents))
  ? bill.participants.find(p => p.userId === me.value)?.amountCents ?? 0
  : equalShare(bill.amountCents, users.value.length)
const unpaidFor = (list: Bill[], userId: number) => list.reduce((sum, b) => {
  const p = b.participants.find(p => p.userId === userId)
  return sum + (p && !p.paidAt ? p.amountCents : 0)
}, 0)
const myUnpaid = (list: Bill[]) => unpaidFor(list, me.value)
const cardUnpaidTotal = (list: Bill[]) => list.reduce((sum, b) => sum + (b.cardPaidAt ? 0 : b.amountCents), 0)
const total = (list: Bill[]) => list.reduce((sum, b) => sum + b.amountCents, 0)

const lastMonthDiff = computed(() => total(bills.value) - total(prevBills.value))
const vsLastMonth = computed(() => {
  if (!prevBills.value.length) return ''
  const diff = total(bills.value) - total(prevBills.value)
  const label = monthLabel(prevMonth.value).split(' ')[0]
  return diff === 0 ? `Same as ${label}` : `${diff > 0 ? '+' : '−'}${formatMoney(Math.abs(diff))} vs ${label}`
})

const stats = computed(() => {
  const list = hasSelection.value ? selectedBills.value : bills.value
  return [
    { title: hasSelection.value ? 'Selected Total' : 'Total This Month', icon: 'i-lucide-receipt-text', cents: total(list), copy: hasSelection.value, tab: 'all' as BillTab, note: hasSelection.value ? '' : vsLastMonth.value, noteIcon: lastMonthDiff.value > 0 ? 'i-lucide-trending-up' : lastMonthDiff.value < 0 ? 'i-lucide-trending-down' : '' },
    { title: hasSelection.value ? 'Selected Unpaid for You' : 'You Still Owe', icon: 'i-lucide-user-round', cents: myUnpaid(list), copy: hasSelection.value, tab: 'mine' as BillTab, note: hasSelection.value ? '' : users.value.filter(u => u.id !== me.value).map(u => `${u.name.split(' ')[0]} owes ${formatMoney(unpaidFor(list, u.id))}`).join(' · ') },
    { title: 'Card Unpaid', icon: 'i-lucide-credit-card', cents: cardUnpaidTotal(list), copy: false, tab: 'ready' as BillTab, note: readyForCardCents(list) ? `${formatMoney(readyForCardCents(list))} ready to pay` : '' }
  ]
})

async function copy(cents: number) {
  await navigator.clipboard.writeText(moneyNumber(cents))
  toast.add({ title: `Copied ${moneyNumber(cents)}`, icon: 'i-lucide-clipboard-check' })
}

// Sorting
type SortKey = 'addedOn' | 'amountCents' | 'share'
const sortBy = ref<SortKey>('addedOn')
const sortDir = ref<'asc' | 'desc'>('desc')
function sort(key: SortKey) {
  if (sortBy.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else {
    sortBy.value = key
    sortDir.value = 'asc'
  }
}
const sortValue = (b: Bill) => sortBy.value === 'share' ? share(b) : sortBy.value === 'amountCents' ? b.amountCents : b.addedOn + String(b.id).padStart(10, '0')
const rows = computed(() => bills.value.filter(b => billInTab(b, tab.value, me.value)).sort((a, b) => {
  const [x, y] = [sortValue(a), sortValue(b)]
  return (x < y ? -1 : x > y ? 1 : 0) * (sortDir.value === 'asc' ? 1 : -1)
}))
// Prune to visible rows so bulk actions never touch bills hidden by the active tab.
watch(() => rows.value, list => (selected.value = selected.value.filter(id => list.some(b => b.id === id))))
const sortIcon = (key: SortKey) => sortBy.value !== key ? 'i-lucide-arrow-up-down' : sortDir.value === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow'

const UTooltip = resolveComponent('UTooltip')
const banks = [
  { label: 'RTP Federal Credit Union (joint account)', url: 'https://www.rtpfcu.org', icon: '/banks/rtpfcu.ico' },
  { label: 'Citi (credit card)', url: 'https://www.citi.com', icon: '/banks/citi.png' }
]

// Totals for whatever the active tab shows, e.g. exactly what Ready for Card will put on the card.
const footerMoney = (cents: number) => rows.value.length ? h('span', { class: 'text-highlighted tabular-nums' }, formatMoney(cents)) : ''

const columns = computed<TableColumn<Bill>[]>(() => [
  { accessorKey: 'addedOn', header: 'Added' },
  { accessorKey: 'name', header: 'Name', footer: () => rows.value.length ? `Total · ${rows.value.length} bill${rows.value.length === 1 ? '' : 's'}` : '', meta: { class: { td: 'min-w-64' } } },
  { accessorKey: 'amountCents', header: 'Amount', footer: () => footerMoney(total(rows.value)), meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'share', header: 'Each', footer: () => footerMoney(rows.value.reduce((sum, b) => sum + share(b), 0)), meta: { class: { th: 'text-right', td: 'text-right' } } },
  ...users.value.map(u => ({ id: `paid_${u.id}`, header: u.name.split(' ')[0], meta: { class: { th: 'text-center', td: 'text-center' } } })),
  { id: 'card', header: 'Card', footer: () => h('div', { class: 'flex justify-center gap-1' }, banks.map(bank => h(UTooltip, { text: bank.label, delayDuration: 0 }, () => h('a', { href: bank.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': bank.label, class: 'inline-flex size-8 items-center justify-center rounded-full hover:bg-elevated transition' }, [h('img', { src: bank.icon, alt: '', class: 'size-5 rounded-sm' })])))), meta: { class: { th: 'text-center', td: 'text-center' } } },
  { id: 'actions', header: () => h('span', { class: 'sr-only' }, 'Actions'), meta: { class: { td: 'w-px' } } }
])

// Create
const form = reactive({ name: '', amount: '' })
const nameMatches = computed(() => filterSuggestions(suggestions.value, form.name))
const creating = ref(false)
async function createBill() {
  const amountCents = parseAmount(form.amount)
  if (!form.name.trim() || amountCents <= 0) {
    toast.add({ title: 'Enter a name and an amount above zero.', color: 'warning' })
    return
  }
  creating.value = true
  const bill = await run(() => $fetch('/api/bills', { method: 'POST', body: { name: form.name, amountCents } }), 'Bill created')
  creating.value = false
  if (!bill) return
  form.name = ''
  form.amount = ''
  if (bill.addedOn.slice(0, 7) !== month.value) await router.push({ query: {} })
  await Promise.all([refresh(), refreshSuggestions()])
}

// Row actions
const busy = ref<string | null>(null)
async function act(key: string, action: () => Promise<unknown>, success: string) {
  busy.value = key
  const ok = await run(action, success)
  busy.value = null
  if (ok) await refresh()
}
const payFor = (bill: Bill, userId: number) =>
  act(`pay:${bill.id}:${userId}`, () => $fetch(`/api/bills/${bill.id}/pay`, { method: 'POST', body: { userId } }), 'Marked as paid')
const payCard = (bill: Bill) =>
  act(`card:${bill.id}`, () => $fetch(`/api/bills/${bill.id}/card-paid`, { method: 'POST' }), 'Card marked paid')
const paySelected = (target: 'me' | 'card') =>
  act(`bulk:${target}`, () => $fetch('/api/bills/pay-selected', { method: 'POST', body: { ids: selected.value, target } }), target === 'me' ? 'Selected bills marked paid' : 'Selected card payments marked paid')
const readyIds = computed(() => bills.value.filter(canMarkCardPaid).map(b => b.id))
const confirmPayAll = ref(false)
watch(tab, () => (confirmPayAll.value = false))
async function payAllReady() {
  confirmPayAll.value = false
  await act('bulk:ready', () => $fetch('/api/bills/pay-selected', { method: 'POST', body: { ids: readyIds.value, target: 'card' } }), 'Card marked paid for all ready bills')
}
const canPaySelectedMe = computed(() => myUnpaid(selectedBills.value) > 0)
const canPaySelectedCard = computed(() => selectedBills.value.some(canMarkCardPaid))

// Inline edit
const inline = ref<{ id: number, field: 'name' | 'amount', value: string } | null>(null)
function startInline(bill: Bill, field: 'name' | 'amount') {
  if (!canEditBill(bill)) return
  inline.value = { id: bill.id, field, value: field === 'name' ? bill.name : moneyNumber(bill.amountCents) }
}
async function saveInline() {
  const edit = inline.value
  inline.value = null
  if (!edit) return
  const bill = bills.value.find(b => b.id === edit.id)
  if (!bill) return
  let body: { name: string } | { amountCents: number }
  if (edit.field === 'name') {
    const name = edit.value.trim()
    if (!name || name === bill.name) return
    body = { name }
  }
  else {
    const amountCents = parseAmount(edit.value)
    if (amountCents <= 0 || amountCents === bill.amountCents) return
    body = { amountCents }
  }
  await act(`inline:${bill.id}`, () => $fetch(`/api/bills/${bill.id}`, { method: 'PATCH', body }), 'Bill updated')
}

// Modal
const editOpen = ref(false)
const editingId = ref<number | null>(null)
const editingBill = computed(() => bills.value.find(b => b.id === editingId.value) ?? null)
function openEdit(bill: Bill) {
  editingId.value = bill.id
  editOpen.value = true
}
</script>

<template>
  <div class="space-y-8">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-1">
        <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" aria-label="Previous month" :class="!canGoBack && 'invisible'" :disabled="!canGoBack" :to="{ query: { month: shiftMonth(month, -1) } }" />
        <h1 class="text-[1.625rem] font-semibold text-highlighted min-w-52 text-center">
          {{ monthLabel(month) }}
        </h1>
        <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" aria-label="Next month" :class="month >= currentMonth() && 'invisible'" :disabled="month >= currentMonth()" :to="{ query: { month: shiftMonth(month, 1) } }" />
      </div>

      <form class="flex flex-wrap items-center gap-3" autocomplete="off" @submit.prevent="createBill">
        <UInputMenu
          v-model="form.name"
          mode="autocomplete"
          :items="nameMatches"
          ignore-filter
          :trailing-icon="undefined"
          :ui="{ trailing: 'hidden' }"
          icon="i-lucide-receipt-text"
          placeholder="Bill Name"
          aria-label="Bill name"
          class="w-56"
          autofocus
        />
        <UInput v-model="form.amount" icon="i-lucide-dollar-sign" placeholder="Amount" aria-label="Amount" inputmode="decimal" class="w-40" />
        <UButton type="submit" :loading="creating" icon="i-lucide-plus">
          New
        </UButton>
      </form>
    </div>

    <div class="grid gap-5 sm:grid-cols-3">
      <button
        v-for="stat in stats"
        :key="stat.title"
        type="button"
        class="surface-card flex items-center gap-4 px-6 py-5 text-left cursor-pointer transition hover:ring-2 hover:ring-primary/30"
        :class="stat.copy && 'ring-2 ring-primary/30 hover:bg-primary/5'"
        :title="stat.copy ? 'Copy amount' : undefined"
        @click="stat.copy ? copy(stat.cents) : setTab(stat.tab)"
      >
        <div class="icon-tile">
          <UIcon :name="stat.icon" class="size-5" />
        </div>
        <div class="min-w-0">
          <div class="text-sm font-medium text-toned flex items-center gap-1">
            {{ stat.title }}
            <UIcon v-if="stat.copy" name="i-lucide-copy" class="size-3.5" />
          </div>
          <div class="text-[1.625rem] leading-tight font-bold text-highlighted tabular-nums">
            {{ formatMoney(stat.cents) }}
          </div>
          <div v-if="stat.note" class="text-xs font-medium text-primary mt-0.5 flex items-center gap-1">
            <UIcon v-if="'noteIcon' in stat && stat.noteIcon" :name="stat.noteIcon" class="size-3.5" />
            {{ stat.note }}
          </div>
        </div>
      </button>
    </div>

    <div class="surface-card overflow-hidden">
      <div class="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-default">
        <div class="max-w-full overflow-x-auto">
          <UTabs
            :model-value="tab"
            :items="tabItems"
            :content="false"
            class="w-fit"
            variant="pill"
            color="neutral"
            :ui="{ list: 'bg-transparent p-0 gap-1', trigger: 'rounded-full px-3.5 py-1.5 font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none before:hidden', indicator: 'hidden' }"
            @update:model-value="setTab"
          />
        </div>
        <template v-if="tab === 'ready' && !hasSelection && readyIds.length">
          <UButton v-if="!confirmPayAll" size="sm" class="rounded-full px-4 ms-auto" icon="i-lucide-credit-card" @click="confirmPayAll = true">
            Pay Card for All {{ readyIds.length }} · {{ formatMoney(readyForCardCents(bills)) }}
          </UButton>
          <template v-else>
            <span class="text-sm text-toned ms-auto">Mark {{ readyIds.length }} card payments paid?</span>
            <UButton size="sm" class="rounded-full px-4" :loading="busy === 'bulk:ready'" @click="payAllReady">
              Confirm
            </UButton>
            <UButton size="sm" color="neutral" variant="ghost" class="rounded-full" @click="confirmPayAll = false">
              Cancel
            </UButton>
          </template>
        </template>
        <template v-if="hasSelection">
          <span class="text-sm text-muted ms-auto">{{ selected.length }} selected</span>
          <UButton v-if="canPaySelectedMe" size="sm" variant="outline" class="rounded-full" :loading="busy === 'bulk:me'" @click="paySelected('me')">
            Pay Selected ({{ myName }})
          </UButton>
          <UButton v-if="canPaySelectedCard" size="sm" variant="outline" class="rounded-full" :loading="busy === 'bulk:card'" @click="paySelected('card')">
            Pay Selected Card
          </UButton>
          <UButton size="sm" color="neutral" variant="ghost" class="rounded-full" @click="selected = []">
            Clear
          </UButton>
        </template>
      </div>

    <UTable
      :data="rows"
      :columns="columns"
      :loading="status === 'pending'"
      sticky
      :empty="tab === 'all' ? 'No bills for this month yet.' : 'Nothing here.'"
      :meta="{ class: { tr: (row) => `cursor-pointer ${selected.includes(row.original.id) ? 'bg-primary/10!' : ''}` } }"
      @select="(_e, row) => toggleSelected(row.original.id)"
    >
      <template #addedOn-header>
        <UButton color="neutral" variant="link" class="-mx-2.5 font-semibold" :trailing-icon="sortIcon('addedOn')" label="Added" @click="sort('addedOn')" />
      </template>
      <template #amountCents-header>
        <UButton color="neutral" variant="link" class="-mx-2.5 font-semibold" :trailing-icon="sortIcon('amountCents')" label="Amount" @click="sort('amountCents')" />
      </template>
      <template #share-header>
        <UButton color="neutral" variant="link" class="-mx-2.5 font-semibold" :trailing-icon="sortIcon('share')" label="Each" @click="sort('share')" />
      </template>

      <template #addedOn-cell="{ row }">
        <UTooltip :text="usDotDate(row.original.addedOn)" :delay-duration="0">
          <span class="tabular-nums text-toned">{{ ordinalDay(row.original.addedOn) }}</span>
        </UTooltip>
      </template>

      <template #name-cell="{ row }">
        <UInput
          v-if="inline?.id === row.original.id && inline.field === 'name'"
          v-model="inline.value"
          size="sm"
          autofocus
          class="w-full"
          @click.stop
          @keydown.enter.prevent="saveInline"
          @keydown.esc="inline = null"
          @blur="saveInline"
        />
        <span
          v-else
           class="font-semibold text-highlighted"
          :class="canEditBill(row.original) && 'hover:underline decoration-dotted cursor-text'"
          :title="canEditBill(row.original) ? 'Click to rename' : undefined"
          @click="canEditBill(row.original) && ($event.stopPropagation(), startInline(row.original, 'name'))"
        >{{ row.original.name }}</span>
      </template>

      <template #amountCents-cell="{ row }">
        <UInput
          v-if="inline?.id === row.original.id && inline.field === 'amount'"
          v-model="inline.value"
          size="sm"
          inputmode="decimal"
          autofocus
          class="w-28 ms-auto"
          @click.stop
          @keydown.enter.prevent="saveInline"
          @keydown.esc="inline = null"
          @blur="saveInline"
        />
        <span
          v-else
          class="tabular-nums"
          :class="canEditBill(row.original) && 'hover:underline decoration-dotted cursor-text'"
          :title="canEditBill(row.original) ? 'Click to change (resets to an even split)' : undefined"
          @click="canEditBill(row.original) && ($event.stopPropagation(), startInline(row.original, 'amount'))"
        >{{ formatMoney(row.original.amountCents) }}</span>
      </template>

      <template #share-cell="{ row }">
        <span class="inline-flex items-center gap-1 tabular-nums">
          <UTooltip v-if="isCustomSplit(row.original.participants.map(p => p.amountCents))" text="Custom split">
            <UIcon name="i-lucide-arrow-left-right" class="size-3.5 text-muted" />
          </UTooltip>
          {{ formatMoney(share(row.original)) }}
        </span>
      </template>

      <template v-for="u in users" :key="u.id" #[`paid_${u.id}-cell`]="{ row }">
        <template v-for="p in [row.original.participants.find(x => x.userId === u.id)]" :key="u.id">
          <UBadge v-if="p?.paidAt" color="success" variant="soft" size="md" icon="i-lucide-check">
            Paid
          </UBadge>
          <UButton
            v-else-if="p && (u.id === me || adminMode)"
            size="sm"
            class="rounded-full px-4"
            :variant="u.id === me ? 'solid' : 'soft'"
            :color="u.id === me ? 'primary' : 'warning'"
            :loading="busy === `pay:${row.original.id}:${u.id}`"
            @click.stop="payFor(row.original, u.id)"
          >
            {{ u.id === me ? 'Pay' : 'Mark Paid' }}
          </UButton>
          <UBadge v-else-if="p" color="warning" variant="soft" size="md">
            Waiting
          </UBadge>
          <span v-else class="text-dimmed">-</span>
        </template>
      </template>

      <template #card-cell="{ row }">
        <UBadge v-if="row.original.cardPaidAt" color="success" variant="soft" size="md" icon="i-lucide-check">
          Paid
        </UBadge>
        <UButton v-else-if="canMarkCardPaid(row.original)" size="sm" variant="outline" class="rounded-full px-4" :loading="busy === `card:${row.original.id}`" @click.stop="payCard(row.original)">
          Pay Card
        </UButton>
        <span v-else class="text-dimmed">—</span>
      </template>

      <template #actions-cell="{ row }">
        <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="Edit bill" @click.stop="openEdit(row.original)" />
      </template>
    </UTable>

    </div>

    <BillEditModal v-model:open="editOpen" :bill="editingBill" :users="users" @changed="refresh" />
  </div>
</template>
