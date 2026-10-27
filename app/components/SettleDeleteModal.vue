<script setup lang="ts">
interface Bill {
  id: number
  name: string
  amountCents: number
  participants: { userId: number, amountCents: number, paidAt: string | null }[]
  credit: { amountCents: number, shares: Record<number, number>, sources: { refundId: number, sourceName: string, amountCents: number, shares: Record<number, number> }[] } | null
}

const props = defineProps<{ bill: Bill | null, users: { id: number, name: string }[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ changed: [] }>()
const run = useApi()
const deleting = ref(false)

const firstName = (id: number) => props.users.find(u => u.id === id)?.name.split(' ')[0] ?? 'Someone'
const sharesText = (shares: Record<number, number>) => Object.entries(shares).map(([id, c]) => `${firstName(Number(id))} ${formatMoney(c)}`).join(' · ')
const s = computed(() => props.bill ? settlement(props.bill) : null)

async function remove() {
  if (!props.bill) return
  deleting.value = true
  const ok = await run(() => $fetch(`/api/bills/${props.bill!.id}`, { method: 'DELETE' }), 'Bill deleted')
  deleting.value = false
  if (ok) {
    open.value = false
    emit('changed')
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="bill ? `Delete ${bill.name}? · ${formatMoney(bill.amountCents)}` : 'Delete bill?'" description="Do this only after the money is settled by hand.">
    <template #body>
      <div v-if="bill && s" class="space-y-4 text-sm">
        <div class="rounded-xl bg-red-50 dark:bg-red-500/10 ring-1 ring-red-200 dark:ring-red-500/20 px-4 py-3 space-y-1 tabular-nums">
          <div class="flex justify-between">
            <span class="text-toned">Shared account received</span><b>{{ formatMoney(s.receivedCents) }}</b>
          </div>
          <div v-for="d in s.deposits" :key="d.userId" class="flex justify-between ps-3">
            <span class="text-toned">{{ firstName(d.userId) }}{{ d.cents === null ? '' : ' deposited' }}</span><b>{{ d.cents === null ? 'not paid' : formatMoney(d.cents) }}</b>
          </div>
          <div v-if="s.creditCents" class="flex justify-between">
            <span class="text-toned">Credit covered</span><b>{{ formatMoney(s.creditCents) }}</b>
          </div>
        </div>
        <div>
          <b class="text-highlighted">To settle it:</b>
          <ol class="list-decimal ps-5 mt-1 space-y-0.5">
            <li v-for="a in s.adds" :key="a.userId">
              {{ firstName(a.userId) }} adds <b>{{ formatMoney(a.cents) }}</b> to the shared account.
            </li>
            <li>Withdraw <b>{{ formatMoney(s.withdrawCents) }}</b> to the card it went on.</li>
          </ol>
        </div>
        <div v-if="bill.credit" class="rounded-xl bg-violet-50 dark:bg-violet-500/10 ring-1 ring-violet-200 dark:ring-violet-500/20 px-4 py-3 space-y-0.5">
          <p v-for="src in bill.credit.sources" :key="src.refundId">
            Deleting returns <b>{{ formatMoney(src.amountCents) }}</b> to the {{ src.sourceName }} credit ({{ sharesText(src.shares) }}).
          </p>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="soft" @click="open = false">
          Cancel
        </UButton>
        <UButton color="error" icon="i-lucide-trash-2" :loading="deleting" @click="remove">
          It's Settled · Delete
        </UButton>
      </div>
    </template>
  </UModal>
</template>
