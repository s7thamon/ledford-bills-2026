<script setup lang="ts">
interface Recurring {
  id: number
  type: 'bill' | 'reimbursement'
  name: string
  amountCents: number
  dayOfMonth: number
  otherUserId: number | null
  active: boolean
  participants: { userId: number, amountCents: number }[]
}

const props = defineProps<{ item: Recurring | null, users: { id: number, name: string }[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ changed: [] }>()
const run = useApi()

const typeItems = [{ label: 'Bill', value: 'bill' }, { label: 'Reimbursement', value: 'reimbursement' }]
const userItems = computed(() => props.users.map(u => ({ label: `${u.name} owes`, value: u.id })))

const state = reactive({ type: 'bill' as Recurring['type'], name: '', amount: '', day: 1, otherUserId: undefined as number | undefined })
const splits = ref<Record<number, string>>({})
const saving = ref(false)
const confirmDelete = ref(false)
const totalCents = computed(() => parseAmount(state.amount))

function evenSplits() {
  const amounts = splitAmounts(totalCents.value, props.users.map(u => u.id))
  splits.value = Object.fromEntries(Object.entries(amounts).map(([id, c]) => [id, moneyNumber(c)]))
}

watch(() => [open.value, props.item] as const, ([isOpen, item]) => {
  if (!isOpen || !item) return
  Object.assign(state, { type: item.type, name: item.name, amount: moneyNumber(item.amountCents), day: item.dayOfMonth, otherUserId: item.otherUserId ?? undefined })
  if (item.participants.length) {
    splits.value = Object.fromEntries(props.users.map(u => [u.id, moneyNumber(item.participants.find(p => p.userId === u.id)?.amountCents ?? 0)]))
  }
  else evenSplits()
  confirmDelete.value = false
}, { immediate: true })

async function save() {
  if (!props.item) return
  saving.value = true
  const body = {
    type: state.type,
    name: state.name,
    amountCents: totalCents.value,
    dayOfMonth: Number(state.day),
    otherUserId: state.type === 'reimbursement' ? state.otherUserId : null,
    splits: state.type === 'bill' ? Object.fromEntries(props.users.map(u => [u.id, parseAmount(splits.value[u.id])])) : undefined
  }
  const ok = await run(() => $fetch(`/api/recurring/${props.item!.id}`, { method: 'PUT', body }), 'Recurring item updated')
  saving.value = false
  if (ok) {
    open.value = false
    emit('changed')
  }
}

async function remove() {
  if (!props.item) return
  const ok = await run(() => $fetch(`/api/recurring/${props.item!.id}`, { method: 'DELETE' }), 'Recurring item deleted')
  if (ok) {
    open.value = false
    emit('changed')
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Edit Recurring" description="Changes apply to future months only.">
    <template #body>
      <form id="edit-recurring" class="space-y-4" @submit.prevent="save">
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Type">
            <USelect v-model="state.type" :items="typeItems" class="w-full" @update:model-value="state.type === 'bill' && evenSplits()" />
          </UFormField>
          <UFormField label="Day of month" hint="1-31">
            <UInputNumber v-model="state.day" :min="1" :max="31" class="w-full" />
          </UFormField>
        </div>
        <UFormField label="Name" required>
          <UInput v-model="state.name" class="w-full" />
        </UFormField>
        <UFormField v-if="state.type === 'reimbursement'" label="Who owes" required>
          <USelect v-model="state.otherUserId" :items="userItems" placeholder="Select" class="w-full" />
        </UFormField>
        <UFormField :label="state.type === 'reimbursement' ? 'Amount owed' : 'Amount'" required>
          <UInput v-model="state.amount" icon="i-lucide-dollar-sign" inputmode="decimal" class="w-full" @update:model-value="state.type === 'bill' && evenSplits()" />
        </UFormField>
        <SplitFields v-if="state.type === 'bill'" v-model="splits" :users="users" :total-cents="totalCents" />
      </form>
    </template>
    <template #footer>
      <div class="flex w-full items-center gap-2">
        <UButton v-if="!confirmDelete" color="error" variant="outline" icon="i-lucide-trash-2" @click="confirmDelete = true">
          Delete
        </UButton>
        <UButton v-else color="error" icon="i-lucide-trash-2" @click="remove">
          Confirm delete
        </UButton>
        <div class="flex-1" />
        <UButton color="neutral" variant="soft" @click="open = false">
          Cancel
        </UButton>
        <UButton type="submit" form="edit-recurring" :loading="saving">
          Save
        </UButton>
      </div>
    </template>
  </UModal>
</template>
