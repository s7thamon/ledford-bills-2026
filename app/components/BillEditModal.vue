<script setup lang="ts">
interface Bill {
  id: number
  name: string
  amountCents: number
  addedOn: string
  cardPaidAt: string | null
  paidByCheck: boolean
  credit: { amountCents: number, shares: Record<number, number>, sources: { refundId: number, sourceName: string, amountCents: number, shares: Record<number, number> }[] } | null
  refunds: { amountCents: number }[]
  participants: { userId: number, amountCents: number, paidAt: string | null }[]
}

const props = defineProps<{ bill: Bill | null, users: { id: number, name: string }[], adminMode: boolean, directPay: boolean }>()
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
const settleOpen = ref(false)
// The bill that actually went on a personal card: admin deletes it once the money is settled by hand.
const adminDeletable = computed(() => !!props.bill && props.adminMode && canAdminDeleteBill(props.bill, props.directPay))
const refundable = computed(() => !!props.bill && !editable.value && onSharedCard(props.bill) && !props.directPay
  && props.bill.amountCents > props.bill.refunds.reduce((s, r) => s + r.amountCents, 0))
const amountsChanged = computed(() => !!props.bill && (totalCents.value !== props.bill.amountCents
  || props.bill.participants.some(p => parseAmount(splits.value[p.userId]) !== p.amountCents)))

// Check can't change once the card or a refund is involved, or after real money was paid against a credit.
const checkLocked = computed(() => !props.bill || !!props.bill.cardPaidAt || props.bill.refunds.length > 0 || (!!props.bill.credit && !canRemoveCredit(props.bill)))
async function setCheck(check: boolean) {
  if (!props.bill) return
  const message = check ? (props.bill.credit ? 'Marked as paid by check; the credit is available again' : 'Marked as paid by check') : 'Back on the shared card'
  if (await run(() => $fetch(`/api/bills/${props.bill!.id}/card`, { method: 'PUT', body: { check } }), message)) emit('changed')
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
        <div class="flex items-center gap-3 rounded-lg ring-1 ring-default px-3 py-2.5">
          <UIcon name="i-lucide-file-pen-line" class="size-5 text-muted shrink-0" />
          <div class="flex-1 text-sm">
            <div class="font-medium text-highlighted">
              Paid by check
            </div>
            <div class="text-xs text-muted">
              From the shared account; nothing goes on the Citi card.
            </div>
          </div>
          <USwitch :model-value="!!bill?.paidByCheck" :disabled="checkLocked" aria-label="Paid by check" @update:model-value="setCheck" />
        </div>
        <UAlert
          v-if="bill?.credit && amountsChanged"
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="`Saving removes the −${formatMoney(bill.credit.amountCents)} credit from ${bill.credit.sources.map(src => src.sourceName).join(', ')}`"
          description="The amounts it was sized for are changing. The credit becomes available again for another bill."
        />
      </form>
      <RefundModal v-model:open="refundOpen" :bill="bill" :users="users" @changed="open = false; emit('changed')" />
      <SettleDeleteModal v-model:open="settleOpen" :bill="bill" :users="users" @changed="open = false; emit('changed')" />
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
        <UButton v-else-if="adminDeletable" color="error" variant="outline" icon="i-lucide-trash-2" @click="settleOpen = true">
          Delete (Admin)
        </UButton>
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
