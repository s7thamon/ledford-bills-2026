<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

useHead({ title: 'Recurring' })
const run = useApi()
const toast = useToast()

const { data: users } = await useFetch('/api/users', { key: 'users', default: () => [] })
const { data: items, refresh, status } = await useFetch('/api/recurring', { key: 'recurring', default: () => [] })
type Item = (typeof items.value)[number]

const userName = (id: number | null) => users.value.find(u => u.id === id)?.name.split(' ')[0] ?? 'Someone'
const typeItems = [{ label: 'Bill', value: 'bill' }, { label: 'Reimbursement', value: 'reimbursement' }]
const userItems = computed(() => users.value.map(u => ({ label: `${u.name} owes`, value: u.id })))

// Create
const form = reactive({ type: 'bill' as Item['type'], name: '', amount: '', day: undefined as number | undefined, otherUserId: undefined as number | undefined })
const creating = ref(false)
async function create() {
  const amountCents = parseAmount(form.amount)
  if (!form.name.trim() || amountCents <= 0 || !Number.isInteger(form.day) || form.day! < 1 || form.day! > 31) {
    toast.add({ title: 'Enter a name, an amount above zero, and a day from 1 to 31.', color: 'warning' })
    return
  }
  creating.value = true
  const ok = await run(() => $fetch('/api/recurring', {
    method: 'POST',
    body: { type: form.type, name: form.name, amountCents, dayOfMonth: form.day, otherUserId: form.type === 'reimbursement' ? form.otherUserId : null }
  }), form.type === 'bill' ? 'Recurring bill created' : 'Recurring reimbursement created')
  creating.value = false
  if (!ok) return
  Object.assign(form, { name: '', amount: '', day: undefined })
  await refresh()
}

// Row helpers
const sameDay = (item: Item) => items.value.filter(i => i.dayOfMonth === item.dayOfMonth)
const isFirst = (item: Item) => sameDay(item)[0]?.id === item.id
const isLast = (item: Item) => sameDay(item).at(-1)?.id === item.id
const isGrouped = (item: Item) => sameDay(item).length > 1
// Same-day bills render as one tinted group: lighter dividers inside it, day number on the first row only.
const rowClass = (item: Item) => [
  item.active ? '' : 'opacity-50',
  isGrouped(item) ? 'bg-primary/5!' : '',
  isGrouped(item) && !isLast(item) ? 'border-b-primary/10' : ''
].join(' ')

async function move(item: Item, direction: -1 | 1) {
  if (await run(() => $fetch(`/api/recurring/${item.id}/move`, { method: 'POST', body: { direction } }))) await refresh()
}
async function setActive(item: Item, active: boolean) {
  if (await run(() => $fetch(`/api/recurring/${item.id}/active`, { method: 'PUT', body: { active } }), active ? 'Resumed' : 'Paused')) await refresh()
}

const monthlyTotal = computed(() => items.value.filter(i => i.active && i.type === 'bill').reduce((s, i) => s + i.amountCents, 0))

const columns: TableColumn<Item>[] = [
  { accessorKey: 'dayOfMonth', header: 'Day', meta: { class: { td: 'order-4 max-md:text-xs' }, style: { td: { '--label': '"Day"' } } } },
  { accessorKey: 'name', header: 'Name', meta: { class: { td: 'min-w-56 order-1 max-md:flex-1' } } },
  { accessorKey: 'type', header: 'Type', meta: { class: { td: 'order-5 max-md:text-xs' } } },
  { accessorKey: 'amountCents', header: 'Amount', meta: { class: { th: 'text-right', td: 'text-right order-2' } } },
  { id: 'split', header: 'Split / Owed by', meta: { class: { td: 'order-5 max-md:text-xs' } } },
  { accessorKey: 'active', header: 'Active', meta: { class: { th: 'text-center', td: 'text-center order-7' } } },
  { id: 'order', header: 'Same-day order', meta: { class: { th: 'text-center', td: 'text-center order-7' } } },
  { id: 'actions', header: () => h('span', { class: 'sr-only' }, 'Actions'), meta: { class: { td: 'w-px order-2' } } }
]

const editOpen = ref(false)
const editingId = ref<number | null>(null)
const editing = computed(() => items.value.find(i => i.id === editingId.value) ?? null)
function openEdit(item: Item) {
  editingId.value = item.id
  editOpen.value = true
}
</script>

<template>
  <div class="space-y-8">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 max-w-sm">
        <h1 class="text-2xl font-semibold text-highlighted">
          Recurring
        </h1>
        <p class="text-sm text-muted">
          Added automatically each month just after midnight.
        </p>
        <p class="text-sm text-muted">
          Active bills total {{ formatMoney(monthlyTotal) }} a month.
        </p>
      </div>

      <form class="ms-auto flex flex-wrap items-center justify-end gap-3" autocomplete="off" @submit.prevent="create">
        <USelect v-model="form.type" :items="typeItems" icon="i-lucide-tag" class="w-36" aria-label="Type" />
        <UInput v-model="form.name" icon="i-lucide-receipt-text" placeholder="Name" aria-label="Name" class="w-48" />
        <USelect v-if="form.type === 'reimbursement'" v-model="form.otherUserId" :items="userItems" icon="i-lucide-user-round" placeholder="Who Owes" class="w-40" aria-label="Who owes" />
        <UInput v-model="form.amount" icon="i-lucide-dollar-sign" :placeholder="form.type === 'reimbursement' ? 'Owed' : 'Amount'" aria-label="Amount" inputmode="decimal" class="w-32" />
        <UInput v-model.number="form.day" icon="i-lucide-calendar-days" placeholder="Day" aria-label="Day of month" inputmode="numeric" maxlength="2" class="w-24" />
        <UButton type="submit" :loading="creating" icon="i-lucide-plus">
          New
        </UButton>
      </form>
    </div>

    <div class="surface-card overflow-hidden">
      <UTable class="stack-table" :data="items" :columns="columns" :loading="status === 'pending'" sticky empty="No recurring bills yet." :meta="{ class: { tr: (row) => rowClass(row.original) } }">
        <template #name-cell="{ row }">
          <span class="font-semibold text-highlighted">{{ row.original.name }}</span>
        </template>
        <template #dayOfMonth-cell="{ row }">
          <span v-if="isFirst(row.original)" class="tabular-nums text-toned">{{ row.original.dayOfMonth }}</span>
          <!-- An empty slot falls back to the raw value, so keep the day for screen readers only. -->
          <span v-else class="sr-only">{{ row.original.dayOfMonth }}</span>
        </template>
        <template #type-cell="{ row }">
          <UBadge :color="row.original.type === 'bill' ? 'primary' : 'warning'" variant="soft" class="rounded-full capitalize">
            {{ row.original.type }}
          </UBadge>
        </template>
        <template #amountCents-cell="{ row }">
          <span class="tabular-nums">{{ formatMoney(row.original.amountCents) }}</span>
        </template>
        <template #split-cell="{ row }">
          <span v-if="row.original.type === 'reimbursement'" class="text-sm">{{ userName(row.original.otherUserId) }} owes</span>
          <span v-else class="inline-flex items-center gap-1 text-sm tabular-nums">
            <UIcon v-if="isCustomSplit(row.original.participants.map(p => p.amountCents))" name="i-lucide-arrow-left-right" class="size-3.5 text-muted" />
            {{ row.original.participants.map(p => `${userName(p.userId)} ${formatMoney(p.amountCents)}`).join(' · ') }}
          </span>
        </template>
        <template #active-cell="{ row }">
          <UTooltip :text="row.original.active ? 'Pause' : 'Resume'" :content="{ side: 'top' }">
            <USwitch :model-value="row.original.active" :aria-label="`Active: ${row.original.name}`" @update:model-value="v => setActive(row.original, v)" />
          </UTooltip>
        </template>
        <template #order-cell="{ row }">
          <div v-if="isGrouped(row.original)" class="inline-flex">
            <UTooltip text="Move Up" :content="{ side: 'top' }">
              <UButton icon="i-lucide-chevron-up" size="xs" color="neutral" variant="ghost" :class="isFirst(row.original) && 'invisible'" :disabled="isFirst(row.original)" aria-label="Move up" @click="move(row.original, -1)" />
            </UTooltip>
            <UTooltip text="Move Down" :content="{ side: 'top' }">
              <UButton icon="i-lucide-chevron-down" size="xs" color="neutral" variant="ghost" :class="isLast(row.original) && 'invisible'" :disabled="isLast(row.original)" aria-label="Move down" @click="move(row.original, 1)" />
            </UTooltip>
          </div>
        </template>
        <template #actions-cell="{ row }">
          <UTooltip text="Edit Recurring" :delay-duration="0" :content="{ side: 'top' }">
            <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="Edit" @click="openEdit(row.original)" />
          </UTooltip>
        </template>
      </UTable>
    </div>

    <RecurringEditModal v-model:open="editOpen" :item="editing" :users="users" @changed="refresh" />
  </div>
</template>
