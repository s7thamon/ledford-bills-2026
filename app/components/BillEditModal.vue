<script setup lang="ts">
interface Bill {
  id: number
  name: string
  amountCents: number
  cardPaidAt: string | null
  participants: { userId: number, amountCents: number, paidAt: string | null }[]
}

const props = defineProps<{ bill: Bill | null, users: { id: number, name: string }[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ changed: [] }>()
const run = useApi()

const name = ref('')
const amount = ref('')
const splits = ref<Record<number, string>>({})
const saving = ref(false)
const confirmDelete = ref(false)

const editable = computed(() => !!props.bill && canEditBill(props.bill))
const deletable = computed(() => !!props.bill && canDeleteBill(props.bill))
const totalCents = computed(() => parseAmount(amount.value))

watch(() => [open.value, props.bill] as const, ([isOpen, bill]) => {
  if (!isOpen || !bill) return
  name.value = bill.name
  amount.value = moneyNumber(bill.amountCents)
  splits.value = Object.fromEntries(props.users.map(u => [u.id, moneyNumber(bill.participants.find(p => p.userId === u.id)?.amountCents ?? 0)]))
  confirmDelete.value = false
}, { immediate: true })

function resplit() {
  const amounts = splitAmounts(totalCents.value, props.users.map(u => u.id))
  splits.value = Object.fromEntries(Object.entries(amounts).map(([id, c]) => [id, moneyNumber(c)]))
}

async function save() {
  if (!props.bill) return
  saving.value = true
  const body = {
    name: name.value,
    amountCents: totalCents.value,
    splits: Object.fromEntries(props.users.map(u => [u.id, parseAmount(splits.value[u.id])]))
  }
  const ok = await run(() => $fetch(`/api/bills/${props.bill!.id}`, { method: 'PATCH', body }), 'Bill updated')
  saving.value = false
  if (ok) {
    open.value = false
    emit('changed')
  }
}

async function remove() {
  if (!props.bill) return
  const ok = await run(() => $fetch(`/api/bills/${props.bill!.id}`, { method: 'DELETE' }), 'Bill deleted')
  if (ok) {
    open.value = false
    emit('changed')
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Edit Bill" :description="editable ? 'Update bill details and split amounts.' : 'This bill has payments, so it is read only.'">
    <template #body>
      <form id="edit-bill" class="space-y-4" @submit.prevent="save">
        <UFormField label="Name" required>
          <UInput v-model="name" :disabled="!editable" class="w-full" />
        </UFormField>
        <UFormField label="Amount" required>
          <UInput v-model="amount" icon="i-lucide-dollar-sign" inputmode="decimal" :disabled="!editable" class="w-full" @update:model-value="resplit" />
        </UFormField>
        <SplitFields v-model="splits" :users="users" :total-cents="totalCents" :disabled="!editable" />
      </form>
    </template>
    <template #footer>
      <div class="flex w-full items-center gap-2">
        <template v-if="deletable">
          <UButton v-if="!confirmDelete" color="error" variant="outline" icon="i-lucide-trash-2" @click="confirmDelete = true">
            Delete
          </UButton>
          <UButton v-else color="error" icon="i-lucide-trash-2" @click="remove">
            Confirm delete
          </UButton>
        </template>
        <div class="flex-1" />
        <UButton color="neutral" variant="soft" @click="open = false">
          Cancel
        </UButton>
        <UButton type="submit" form="edit-bill" :loading="saving" :disabled="!editable">
          Save
        </UButton>
      </div>
    </template>
  </UModal>
</template>
