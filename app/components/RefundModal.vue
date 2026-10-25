<script setup lang="ts">
interface Bill {
  id: number
  name: string
  amountCents: number
  addedOn: string
  participants: { userId: number, amountCents: number }[]
  refunds: { amountCents: number }[]
}

const props = defineProps<{ bill: Bill | null, users: { id: number, name: string }[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ changed: [] }>()
const run = useApi()

const amount = ref('')
const refundedOn = ref(todayIso())
const saving = ref(false)

const remaining = computed(() => props.bill ? props.bill.amountCents - props.bill.refunds.reduce((s, r) => s + r.amountCents, 0) : 0)
const cents = computed(() => parseAmount(amount.value))
const valid = computed(() => cents.value > 0 && cents.value <= remaining.value)
const shares = computed(() => props.bill && valid.value ? splitRefund(cents.value, props.bill.participants) : {})
const firstName = (id: number) => props.users.find(u => u.id === id)?.name.split(' ')[0] ?? 'Someone'

watch(open, (isOpen) => {
  if (!isOpen) return
  // Start empty so a partial return is never saved as a full refund by accident.
  amount.value = ''
  refundedOn.value = todayIso()
})

async function save() {
  if (!props.bill || !valid.value) return
  saving.value = true
  const ok = await run(() => $fetch(`/api/bills/${props.bill!.id}/refunds`, { method: 'POST', body: { amountCents: cents.value, refundedOn: refundedOn.value } }), 'Refund recorded')
  saving.value = false
  if (ok) {
    open.value = false
    emit('changed')
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="`Record Refund · ${bill?.name ?? ''}`" :description="bill ? `Paid ${formatMoney(bill.amountCents)} on ${usDotDate(bill.addedOn)}. The refund becomes a credit a later bill can use.` : ''">
    <template #body>
      <form id="record-refund" class="space-y-4" @submit.prevent="save">
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Refund Amount" required>
            <UInput v-model="amount" icon="i-lucide-dollar-sign" inputmode="decimal" :placeholder="`Up to ${moneyNumber(remaining)}`" class="w-full" autofocus />
            <template #help>
              <UButton variant="link" size="xs" class="p-0" @click="amount = moneyNumber(remaining)">
                Use full {{ formatMoney(remaining) }}
              </UButton>
            </template>
          </UFormField>
          <UFormField label="Date It Hit the Card" required>
            <UInput v-model="refundedOn" type="date" class="w-full" />
          </UFormField>
        </div>
        <div v-if="valid" class="rounded-xl bg-violet-50 dark:bg-violet-500/10 ring-1 ring-violet-200 dark:ring-violet-500/20 px-4 py-3 text-sm space-y-1">
          <div class="flex justify-between">
            <span class="text-toned">Card credit</span><b class="tabular-nums">{{ formatMoney(cents) }}</b>
          </div>
          <div v-for="(c, userId) in shares" :key="userId" class="flex justify-between">
            <span class="text-toned">{{ firstName(Number(userId)) }}'s credit</span><b class="tabular-nums">{{ formatMoney(c) }}</b>
          </div>
        </div>
        <p v-else-if="amount" class="text-sm text-error">
          Enter an amount between $0.01 and {{ formatMoney(remaining) }}.
        </p>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="soft" @click="open = false">
          Cancel
        </UButton>
        <UButton type="submit" form="record-refund" :loading="saving" :disabled="!valid">
          Record Refund
        </UButton>
      </div>
    </template>
  </UModal>
</template>
