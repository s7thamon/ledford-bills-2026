<script setup lang="ts">
interface Refund { id: number, billId: number, billName: string, refundedOn: string, left: Record<number, number>, leftCents: number }
interface Bill { id: number, name: string, amountCents: number, participants: { userId: number, amountCents: number }[] }

const props = defineProps<{ bill: Bill | null, refunds: Refund[], users: { id: number, name: string }[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ changed: [] }>()
const run = useApi()
const applying = ref(false)

// Freeze the credit when the popup opens, so its numbers don't jump while it closes after applying.
const refunds = ref<Refund[]>([])
watch(open, (isOpen) => {
  if (isOpen) refunds.value = props.refunds
}, { immediate: true })
const pieces = computed(() => props.bill ? sizeBite(props.bill, poolsFromRefunds(refunds.value)) : [])
const credit = computed(() => creditFromPieces(pieces.value))
const sources = computed(() => refunds.value.filter(r => pieces.value.some(x => x.refundId === r.id)))
const leftBefore = computed(() => sources.value.reduce((s, r) => s + r.leftCents, 0))
const leftAfter = computed(() => refunds.value.reduce((s, r) => s + r.leftCents, 0) - credit.value.amountCents)
const firstName = (id: number) => props.users.find(u => u.id === id)?.name.split(' ')[0] ?? 'Someone'

async function apply() {
  if (!props.bill) return
  applying.value = true
  const ok = await run(() => $fetch(`/api/bills/${props.bill!.id}/credit`, { method: 'POST' }), 'Credit applied')
  applying.value = false
  if (ok) {
    open.value = false
    emit('changed')
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Use Refund Credit?">
    <template #body>
      <div v-if="bill && pieces.length" class="space-y-4">
        <p class="text-sm text-toned">
          Credit left from
          <template v-for="(r, i) in sources" :key="r.id">
            <b class="text-highlighted">{{ r.billName }}</b> (refunded {{ usDotDate(r.refundedOn) }}){{ i < sources.length - 1 ? ' and ' : '' }}
          </template>:
          <b class="text-highlighted">{{ formatMoney(leftBefore) }}</b>.
          {{ credit.amountCents >= leftBefore ? 'This bill can use all of it.' : '' }}
        </p>
        <div class="rounded-xl bg-violet-50 dark:bg-violet-500/10 ring-1 ring-violet-200 dark:ring-violet-500/20 px-4 py-3 text-sm space-y-1 tabular-nums">
          <div class="flex justify-between">
            <span class="text-toned">{{ bill.name }}</span><b>{{ formatMoney(bill.amountCents) }}</b>
          </div>
          <div class="flex justify-between">
            <span class="text-toned">Credit used</span><b class="text-violet-700 dark:text-violet-300">−{{ formatMoney(credit.amountCents) }}</b>
          </div>
          <div class="border-t border-violet-200 dark:border-violet-500/20 my-1" />
          <div v-for="p in bill.participants" :key="p.userId" class="flex justify-between">
            <span class="text-toned">{{ firstName(p.userId) }} deposits</span>
            <b>{{ formatMoney(shareDue(p, credit)) }} <small class="font-normal text-muted">({{ formatMoney(p.amountCents) }} − {{ formatMoney(credit.shares[p.userId] ?? 0) }})</small></b>
          </div>
          <div class="flex justify-between">
            <span class="text-toned">Joint pays Citi</span><b>{{ formatMoney(cardDue({ amountCents: bill.amountCents, credit })) }}</b>
          </div>
          <div class="border-t border-violet-200 dark:border-violet-500/20 my-1" />
          <div class="flex justify-between">
            <span class="text-toned">Credit left after</span><b>{{ formatMoney(leftAfter) }}{{ leftAfter ? '' : ' · used up' }}</b>
          </div>
        </div>
        <UAlert color="warning" variant="soft" icon="i-lucide-triangle-alert" title="Paying this bill by check?" description="Choose Not Now. Credit only works on bills that go on the Citi card." />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="soft" @click="open = false">
          Not Now
        </UButton>
        <UButton :loading="applying" icon="i-lucide-badge-percent" @click="apply">
          Use {{ formatMoney(credit.amountCents) }} Credit
        </UButton>
      </div>
    </template>
  </UModal>
</template>
