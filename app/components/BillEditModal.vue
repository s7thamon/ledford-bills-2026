<script setup lang="ts">
interface Bill {
  id: number
  name: string
  amountCents: number
  addedOn: string
  cardPaidAt: string | null
  paidWithCardOf: number | null
  paidByCheck: boolean
  credit: { amountCents: number, shares: Record<number, number>, sourceName: string } | null
  refunds: { amountCents: number }[]
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

const editable = computed(() => !!props.bill && canEditAmounts(props.bill))
const deletable = computed(() => !!props.bill && canDeleteBill(props.bill))
const totalCents = computed(() => parseAmount(amount.value))
const refundOpen = ref(false)
const refundable = computed(() => !!props.bill && !editable.value && onSharedCard(props.bill)
  && props.bill.amountCents > props.bill.refunds.reduce((s, r) => s + r.amountCents, 0))
const amountsChanged = computed(() => !!props.bill && (totalCents.value !== props.bill.amountCents
  || props.bill.participants.some(p => parseAmount(splits.value[p.userId]) !== p.amountCents)))

// USelect cannot hold null, so 0 stands for the shared card.
// -1 is "Check": paid from the shared account, never on a card.
const cardItems = computed(() => [{ label: 'Shared card (Citi)', value: 0 }, { label: 'Check (shared account)', value: -1 }, ...props.users.map(u => ({ label: `${u.name.split(' ')[0]}'s personal card`, value: u.id }))])
async function setCard(value: number) {
  if (!props.bill) return
  const message = value === -1 ? 'Marked as paid by check' : value ? 'Marked as paid with a different card' : 'Back on the shared card'
  if (await run(() => $fetch(`/api/bills/${props.bill!.id}/card`, { method: 'PUT', body: { userId: value > 0 ? value : null, check: value === -1 } }), message)) emit('changed')
}

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
        <UFormField label="Paid With" help="Pick a personal card if this was not charged to the shared Citi card.">
          <USelect :model-value="bill?.paidByCheck ? -1 : bill?.paidWithCardOf ?? 0" :items="cardItems" class="w-full" :disabled="!bill || !!bill.cardPaidAt || !!bill.credit || bill.refunds.length > 0" @update:model-value="v => setCard(Number(v))" />
        </UFormField>
        <UAlert
          v-if="bill?.credit && amountsChanged"
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="`Saving removes the −${formatMoney(bill.credit.amountCents)} credit from ${bill.credit.sourceName}`"
          description="The amounts it was sized for are changing. The credit becomes available again for another bill."
        />
      </form>
      <RefundModal v-model:open="refundOpen" :bill="bill" :users="users" @changed="open = false; emit('changed')" />
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
        <UButton v-if="refundable" color="error" variant="soft" icon="i-lucide-undo-2" @click="refundOpen = true">
          Record Refund
        </UButton>
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
