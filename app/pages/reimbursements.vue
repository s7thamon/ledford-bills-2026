<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

useHead({ title: 'Reimbursements' })
const run = useApi()
const toast = useToast()
const { user, session } = useUserSession()
const me = computed(() => user.value!.id)
const adminMode = computed(() => !!session.value?.adminMode)

type Sort = 'createdAt' | 'name' | 'owedCents' | 'status'
const resolved = ref(false)
const page = ref(1)
const sort = ref<Sort>('createdAt')
const dir = ref<'asc' | 'desc'>('desc')
const search = ref('')
watch([resolved, search], () => (page.value = 1))

const { data: users } = await useFetch('/api/users', { key: 'users', default: () => [] })
const { data, refresh, status } = await useFetch('/api/reimbursements', {
  key: 'reimbursements',
  query: computed(() => ({ resolved: resolved.value, page: page.value, sort: sort.value, dir: dir.value, q: search.value.trim() || undefined })),
  default: () => ({ items: [], total: 0, pageSize: 10, openOwedTo: {} as Record<number, number> })
})
// Count for the inactive tab; the active tab's count is data.total.
const { data: other, refresh: refreshOther } = await useFetch('/api/reimbursements', {
  key: 'reimbursements-other',
  query: computed(() => ({ resolved: !resolved.value, page: 1, q: search.value.trim() || undefined })),
  default: () => ({ items: [], total: 0, pageSize: 10, openOwedTo: {} as Record<number, number> })
})
// Live updates only refresh the 'reimbursements' key, so follow the active list to keep this count current.
watch(data, () => refreshOther())
const tabItems = computed(() => [
  { label: 'Open', value: 'open', badge: resolved.value ? other.value.total : data.value.total },
  // The API's resolved=true includes completed items alongside open ones, so this tab is "All".
  { label: 'All', value: 'all', badge: resolved.value ? data.value.total : other.value.total }
].map(item => ({ ...item, badge: { label: String(item.badge), size: 'sm' as const, color: ((item.value === 'all') === resolved.value ? 'primary' : 'neutral') as 'primary' | 'neutral', variant: 'soft' as const } })))
type Item = (typeof data.value.items)[number]

// Selection, like Bills: totals switch to the selected rows and become copyable.
const selected = ref<number[]>([])
watch(data, () => (selected.value = selected.value.filter(id => data.value.items.some(i => i.id === id))))
const toggleSelected = (id: number) => (selected.value = selected.value.includes(id) ? selected.value.filter(x => x !== id) : [...selected.value, id])
const stats = computed(() => {
  const name = otherUser.value?.name.split(' ')[0] ?? 'They'
  if (selected.value.length) {
    const rows = data.value.items.filter(i => selected.value.includes(i.id))
    const sum = (list: Item[]) => list.reduce((s, i) => s + i.owedCents, 0)
    return [
      { title: 'Selected Total', icon: 'i-lucide-receipt-text', cents: sum(rows) },
      { title: `Selected ${name} Owes You`, icon: 'i-lucide-arrow-down-left', cents: sum(rows.filter(i => i.createdBy === me.value)) },
      { title: `Selected You Owe ${name}`, icon: 'i-lucide-arrow-up-right', cents: sum(rows.filter(i => i.createdBy !== me.value)) }
    ]
  }
  const owed = data.value.openOwedTo
  const toMe = owed[me.value] ?? 0
  const all = Object.values(owed).reduce((s, c) => s + c, 0)
  // Clicking a card selects its open rows on this page, which turns the cards into selected totals.
  const open = data.value.items.filter(i => !i.completedAt)
  return [
    { title: 'Open Total', icon: 'i-lucide-receipt-text', cents: all, ids: open.map(i => i.id) },
    { title: `${name} Owes You`, icon: 'i-lucide-arrow-down-left', cents: toMe, ids: open.filter(i => i.createdBy === me.value).map(i => i.id) },
    { title: `You Owe ${name}`, icon: 'i-lucide-arrow-up-right', cents: all - toMe, ids: open.filter(i => i.createdBy !== me.value).map(i => i.id) }
  ]
})
function clickStat(stat: (typeof stats.value)[number]) {
  if (selected.value.length) copy(stat.cents)
  else if ('ids' in stat) selected.value = stat.ids
}
async function copy(cents: number) {
  await navigator.clipboard.writeText(moneyNumber(cents))
  toast.add({ title: `Copied ${moneyNumber(cents)}`, icon: 'i-lucide-clipboard-check' })
}

const firstName = (id: number) => users.value.find(u => u.id === id)?.name.split(' ')[0] ?? 'Someone'
const otherUser = computed(() => users.value.find(u => u.id !== me.value))

function sortBy(key: Sort) {
  if (sort.value === key) dir.value = dir.value === 'asc' ? 'desc' : 'asc'
  else {
    sort.value = key
    dir.value = key === 'createdAt' ? 'desc' : 'asc'
  }
  page.value = 1
}
const sortIcon = (key: Sort) => sort.value !== key ? 'i-lucide-arrow-up-down' : dir.value === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow'

const statusMeta = {
  awaiting: { label: 'Awaiting Payment', color: 'warning' },
  sent: { label: 'Payment Sent', color: 'info' },
  received: { label: 'Received', color: 'success' }
} as const

function flow(r: Item) {
  return r.createdBy === me.value ? `${firstName(r.otherUserId)} owes you` : `You owe ${firstName(r.createdBy)}`
}
function description(r: Item) {
  const amount = formatMoney(r.owedCents)
  const s = reimbursementStatus(r)
  const mine = r.createdBy === me.value
  if (s === 'received') return mine ? 'You confirmed receipt.' : `${firstName(r.createdBy)} confirmed receipt.`
  if (s === 'sent') return mine ? `${firstName(r.otherUserId)} marked this as sent. Confirm once it arrives.` : `You marked this as sent. Waiting for ${firstName(r.createdBy)} to confirm.`
  return mine ? `${firstName(r.otherUserId)} still owes you ${amount}.` : `You still owe ${firstName(r.createdBy)} ${amount}.`
}

const canSend = (r: Item) => canMarkTransferComplete(r, me.value) || (adminMode.value && reimbursementStatus(r) === 'awaiting')
const canConfirm = (r: Item) => canMarkReimbursementComplete(r, me.value) || (adminMode.value && reimbursementStatus(r) === 'sent')

// Create
const form = reactive({ name: '', owed: '' })
const creating = ref(false)
async function create() {
  const owedCents = parseAmount(form.owed)
  if (!form.name.trim() || owedCents <= 0) {
    toast.add({ title: 'Enter a name and an amount above zero.', color: 'warning' })
    return
  }
  creating.value = true
  const ok = await run(() => $fetch('/api/reimbursements', { method: 'POST', body: { name: form.name, owedCents } }), 'Reimbursement created')
  creating.value = false
  if (!ok) return
  Object.assign(form, { name: '', owed: '' })
  await refresh()
}

const busy = ref<string | null>(null)
async function act(key: string, url: string, success: string) {
  busy.value = key
  const ok = await run(() => $fetch(url, { method: 'POST' }), success)
  busy.value = null
  if (ok) await refresh()
}

const columns: TableColumn<Item>[] = [
  { accessorKey: 'createdAt', header: 'Added', meta: { class: { td: 'order-4 max-md:text-xs' } } },
  { accessorKey: 'name', header: 'Name', meta: { class: { td: 'min-w-56 order-1 max-md:flex-1' } } },
  { accessorKey: 'owedCents', header: 'Owed', meta: { class: { th: 'text-right', td: 'text-right order-2' } } },
  { id: 'flow', header: 'Who', meta: { class: { td: 'order-5' } } },
  { id: 'status', header: 'Status', meta: { class: { td: 'order-7' } } },
  { id: 'actions', header: () => h('span', { class: 'sr-only' }, 'Actions'), meta: { class: { th: 'text-right', td: 'text-right order-7 max-md:ms-auto' } } }
]

const editOpen = ref(false)
const editingId = ref<number | null>(null)
const editing = computed(() => data.value.items.find(i => i.id === editingId.value) ?? null)
function openEdit(item: Item) {
  editingId.value = item.id
  editOpen.value = true
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold text-highlighted">
          Reimbursements
        </h1>
        <p class="text-sm text-muted">
          Ask {{ otherUser?.name.split(' ')[0] ?? 'the other person' }} to pay you back.
        </p>
      </div>
      <form class="flex flex-wrap items-center gap-3" autocomplete="off" @submit.prevent="create">
        <UInput v-model="form.name" icon="i-lucide-receipt-text" placeholder="What For" aria-label="Name" class="w-56" />
        <UInput v-model="form.owed" icon="i-lucide-dollar-sign" placeholder="Amount Owed" aria-label="Amount Owed" inputmode="decimal" class="w-40" />
        <UButton type="submit" :loading="creating" icon="i-lucide-plus">
          New
        </UButton>
      </form>
    </div>

    <div class="grid gap-5 sm:grid-cols-3">
      <UTooltip v-for="stat in stats" :key="stat.title" :text="selected.length ? 'Copy Amount' : 'Select These Rows'" :content="{ side: 'top' }">
        <button
          type="button"
          class="surface-card flex items-center gap-4 px-6 py-5 text-left cursor-pointer transition hover:ring-2 hover:ring-primary/30"
          :class="selected.length > 0 && 'ring-2 ring-primary/30 hover:bg-primary/5'"
          @click="clickStat(stat)"
        >
          <div class="icon-tile">
            <UIcon :name="stat.icon" class="size-5" />
          </div>
          <div class="min-w-0">
            <div class="text-sm font-medium text-toned flex items-center gap-1">
              {{ stat.title }}
              <UIcon v-if="selected.length" name="i-lucide-copy" class="size-3.5" />
            </div>
            <div class="text-[1.625rem] leading-tight font-bold text-highlighted tabular-nums">
              {{ formatMoney(stat.cents) }}
            </div>
          </div>
        </button>
      </UTooltip>
    </div>

    <div class="surface-card overflow-hidden">
      <div class="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-default">
        <UTabs
          :model-value="resolved ? 'all' : 'open'"
          :items="tabItems"
          :content="false"
          class="w-fit"
          variant="pill"
          color="neutral"
          :ui="{ list: 'bg-transparent p-0 gap-1', trigger: 'rounded-full px-3.5 py-1.5 font-medium data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none before:hidden', indicator: 'hidden' }"
          @update:model-value="v => (resolved = v === 'all')"
        />
        <template v-if="selected.length">
          <span class="text-sm text-muted ms-auto">{{ selected.length }} selected</span>
          <UButton size="sm" color="neutral" variant="ghost" class="rounded-full" @click="selected = []">
            Clear
          </UButton>
        </template>
        <UInput v-else v-model="search" icon="i-lucide-search" placeholder="Search Reimbursements" aria-label="Search reimbursements by name or amount" size="sm" class="w-48 ms-auto" />
      </div>

      <UTable
        class="stack-table"
        :data="data.items"
        :columns="columns"
        :loading="status === 'pending'"
        empty="Nothing waiting. All settled up."
        :meta="{ class: { tr: (row) => selected.includes(row.original.id) ? 'bg-primary/10!' : '' } }"
        @select="(_e, row) => toggleSelected(row.original.id)"
      >
        <template #createdAt-header>
          <UButton color="neutral" variant="link" class="-mx-2.5 font-semibold" :trailing-icon="sortIcon('createdAt')" label="Added" @click="sortBy('createdAt')" />
        </template>
        <template #name-header>
          <UButton color="neutral" variant="link" class="-mx-2.5 font-semibold" :trailing-icon="sortIcon('name')" label="Name" @click="sortBy('name')" />
        </template>
        <template #owedCents-header>
          <UButton color="neutral" variant="link" class="-mx-2.5 font-semibold" :trailing-icon="sortIcon('owedCents')" label="Owed" @click="sortBy('owedCents')" />
        </template>
        <template #status-header>
          <UButton color="neutral" variant="link" class="-mx-2.5 font-semibold" :trailing-icon="sortIcon('status')" label="Status" @click="sortBy('status')" />
        </template>

        <template #createdAt-cell="{ row }">
          <span class="tabular-nums text-muted">{{ dotDate(new Date(row.original.createdAt).toLocaleDateString('en-CA')) }}</span>
        </template>
        <template #name-cell="{ row }">
          <div class="font-semibold text-highlighted">{{ row.original.name }}</div>
          <div v-if="row.original.notes" class="text-xs text-muted whitespace-pre-line">
            {{ row.original.notes }}
          </div>
        </template>
        <template #owedCents-cell="{ row }">
          <span class="tabular-nums">{{ formatMoney(row.original.owedCents) }}</span>
        </template>
        <template #flow-cell="{ row }">
          <div class="text-sm">
            {{ flow(row.original) }}
          </div>
          <div class="text-xs text-muted">
            {{ description(row.original) }}
          </div>
        </template>
        <template #status-cell="{ row }">
          <UBadge :color="statusMeta[reimbursementStatus(row.original)].color" variant="soft" class="rounded-full">
            {{ statusMeta[reimbursementStatus(row.original)].label }}
          </UBadge>
        </template>
        <template #actions-cell="{ row }">
          <div class="inline-flex items-center gap-1" @click.stop>
            <UButton
              v-if="canSend(row.original)"
              size="sm"
              variant="outline"
              :loading="busy === `send:${row.original.id}`"
              @click="act(`send:${row.original.id}`, `/api/reimbursements/${row.original.id}/transfer`, 'Transfer marked complete')"
            >
              Mark Sent
            </UButton>
            <UButton
              v-if="canConfirm(row.original)"
              size="sm"
              :loading="busy === `done:${row.original.id}`"
              @click="act(`done:${row.original.id}`, `/api/reimbursements/${row.original.id}/complete`, 'Reimbursement completed')"
            >
              Confirm Received
            </UButton>
            <UTooltip v-if="canEditReimbursement(row.original, me)" text="Edit Reimbursement" :delay-duration="0" :content="{ side: 'top' }">
              <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="Edit" @click="openEdit(row.original)" />
            </UTooltip>
          </div>
        </template>
      </UTable>
    </div>

    <div v-if="data.total > data.pageSize" class="flex justify-end">
      <UPagination v-model:page="page" :total="data.total" :items-per-page="data.pageSize" />
    </div>

    <ReimbursementEditModal v-model:open="editOpen" :item="editing" @changed="refresh" />
  </div>
</template>
