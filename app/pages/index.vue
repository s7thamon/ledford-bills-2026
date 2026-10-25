<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const route = useRoute()
const router = useRouter()
const run = useApi()
const toast = useToast()
const { user, session } = useUserSession()

const month = computed(() => isMonth(route.query.month) ? route.query.month : currentMonth())
const tab = computed<BillTab>(() => isBillTab(route.query.tab) ? route.query.tab : 'all')
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
  router.replace({ query: { ...route.query, tab: t === 'all' ? undefined : String(t) } })
}
const counts = computed(() => tabCounts(bills.value, me.value))
const tabItems = computed(() => [
  { label: 'All', value: 'all', badge: counts.value.all },
  { label: `${myName.value} unpaid`, value: 'mine', badge: counts.value.mine },
  { label: 'Card unpaid', value: 'card', badge: counts.value.card },
  { label: 'Ready for card', value: 'ready', badge: counts.value.ready }
].map(item => ({ ...item, badge: { label: String(item.badge), size: 'sm' as const, color: (tab.value === item.value ? 'primary' : 'neutral') as 'primary' | 'neutral', variant: 'soft' as const } })))

// Amounts
const share = (bill: Bill) => isCustomSplit(bill.participants.map(p => p.amountCents))
  ? bill.participants.find(p => p.userId === me.value)?.amountCents ?? 0
  : equalShare(bill.amountCents, users.value.length)
const myUnpaid = (list: Bill[]) => list.reduce((sum, b) => {
  const p = b.participants.find(p => p.userId === me.value)
  return sum + (p && !p.paidAt ? p.amountCents : 0)
}, 0)
const cardUnpaidTotal = (list: Bill[]) => list.reduce((sum, b) => sum + (b.cardPaidAt ? 0 : b.amountCents), 0)
const total = (list: Bill[]) => list.reduce((sum, b) => sum + b.amountCents, 0)

const stats = computed(() => {
  const list = hasSelection.value ? selectedBills.value : bills.value
  return [
    { title: hasSelection.value ? 'Selected total' : 'Total this month', icon: 'i-lucide-sigma', cents: total(list), copy: hasSelection.value },
    { title: hasSelection.value ? `Selected unpaid for ${myName.value}` : `${myName.value} still owes`, icon: 'i-lucide-user-round', cents: myUnpaid(list), copy: hasSelection.value },
    { title: 'Card unpaid', icon: 'i-lucide-credit-card', cents: cardUnpaidTotal(list), copy: false, ready: readyForCardCents(list) }
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

const columns = computed<TableColumn<Bill>[]>(() => [
  { accessorKey: 'addedOn', header: 'Added' },
  { accessorKey: 'name', header: 'Name', meta: { class: { td: 'min-w-64' } } },
  { accessorKey: 'amountCents', header: 'Amount', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'share', header: 'Each', meta: { class: { th: 'text-right', td: 'text-right' } } },
  ...users.value.map(u => ({ id: `paid_${u.id}`, header: u.name.split(' ')[0], meta: { class: { th: 'text-center', td: 'text-center' } } })),
  { id: 'card', header: 'Card', meta: { class: { th: 'text-center', td: 'text-center' } } },
  { id: 'actions', header: '', meta: { class: { td: 'w-px' } } }
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
        <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" aria-label="Previous month" :to="{ query: { month: shiftMonth(month, -1) } }" />
        <h1 class="text-[1.625rem] font-semibold text-highlighted min-w-52 text-center">
          {{ monthLabel(month) }}
        </h1>
        <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" aria-label="Next month" :disabled="month >= currentMonth()" :to="{ query: { month: shiftMonth(month, 1) } }" />
      </div>

      <form class="flex flex-wrap items-center gap-3" autocomplete="off" @submit.prevent="createBill">
        <UInputMenu
          v-model="form.name"
          mode="autocomplete"
          :items="nameMatches"
          ignore-filter
          open-on-focus
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
      <component
        :is="stat.copy ? 'button' : 'div'"
        v-for="stat in stats"
        :key="stat.title"
        type="button"
        class="surface-card flex items-center gap-4 px-6 py-5 text-left"
        :class="stat.copy && 'cursor-pointer ring-2 ring-primary/30 hover:bg-primary/5 transition'"
        :title="stat.copy ? 'Copy amount' : undefined"
        @click="stat.copy && copy(stat.cents)"
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
          <div v-if="stat.ready" class="text-xs font-medium text-primary mt-0.5">
            {{ formatMoney(stat.ready) }} ready to pay
          </div>
        </div>
      </component>
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
        <template v-if="hasSelection">
          <span class="text-sm text-muted ms-auto">{{ selected.length }} selected</span>
          <UButton size="sm" variant="outline" class="rounded-full" :disabled="!canPaySelectedMe" :loading="busy === 'bulk:me'" @click="paySelected('me')">
            Pay selected ({{ myName }})
          </UButton>
          <UButton size="sm" variant="outline" class="rounded-full" :disabled="!canPaySelectedCard" :loading="busy === 'bulk:card'" @click="paySelected('card')">
            Pay selected card
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
      :meta="{ class: { tr: (row) => `cursor-pointer ${selected.includes(row.original.id) ? 'bg-primary/10' : ''}` } }"
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
        <span class="tabular-nums text-toned">{{ dotDate(row.original.addedOn) }}</span>
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
          Pay card
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
