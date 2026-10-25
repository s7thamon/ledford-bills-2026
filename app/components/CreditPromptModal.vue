<script setup lang="ts">
interface Refund { id: number, billName: string, refundedOn: string, amountCents: number, shares: Record<number, number> }
interface Bill { id: number, name: string, amountCents: number, participants: { userId: number, amountCents: number }[] }

const props = defineProps<{ refund: Refund | null, bill: Bill | null, users: { id: number, name: string }[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ changed: [] }>()
const run = useApi()
const applying = ref(false)

const credit = computed(() => props.refund ? { amountCents: props.refund.amountCents, shares: props.refund.shares } : null)
const firstName = (id: number) => props.users.find(u => u.id === id)?.name.split(' ')[0] ?? 'Someone'

async function apply() {
  if (!props.refund || !props.bill) return
  applying.value = true
  const ok = await run(() => $fetch(`/api/refunds/${props.refund!.id}/apply`, { method: 'POST', body: { billId: props.bill!.id } }), 'Credit applied')
  applying.value = false
  if (ok) {
    open.value = false
    emit('changed')
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Apply Refund Credit?">
    <template #body>
      <div v-if="refund && bill && credit" class="space-y-4">
        <p class="text-sm text-toned">
          You have an unused credit from <b class="text-highlighted">{{ refund.billName }}</b> (refunded {{ usDotDate(refund.refundedOn) }}). This new bill is big enough to use all of it.
        </p>
        <div class="rounded-xl bg-violet-50 dark:bg-violet-500/10 ring-1 ring-violet-200 dark:ring-violet-500/20 px-4 py-3 text-sm space-y-1 tabular-nums">
          <div class="flex justify-between">
            <span class="text-toned">{{ bill.name }}</span><b>{{ formatMoney(bill.amountCents) }}</b>
          </div>
          <div class="flex justify-between">
            <span class="text-toned">Credit applied</span><b class="text-violet-700 dark:text-violet-300">−{{ formatMoney(refund.amountCents) }}</b>
          </div>
          <div class="border-t border-violet-200 dark:border-violet-500/20 my-1" />
          <div v-for="p in bill.participants" :key="p.userId" class="flex justify-between">
            <span class="text-toned">{{ firstName(p.userId) }} deposits</span><b>{{ formatMoney(shareDue(p, credit)) }}</b>
          </div>
          <div class="flex justify-between">
            <span class="text-toned">Joint pays Citi</span><b>{{ formatMoney(cardDue({ amountCents: bill.amountCents, credit })) }}</b>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="soft" @click="open = false">
          Not Now
        </UButton>
        <UButton :loading="applying" icon="i-lucide-badge-percent" @click="apply">
          Apply Credit
        </UButton>
      </div>
    </template>
  </UModal>
</template>
