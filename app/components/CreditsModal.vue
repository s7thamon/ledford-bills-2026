<script setup lang="ts">
interface Refund {
  id: number
  billId: number
  billName: string
  billAddedOn: string
  amountCents: number
  refundedOn: string
  shares: Record<number, number>
  appliedToBillId: number | null
  appliedToName: string | null
  appliedToAddedOn: string | null
}
interface Bill {
  id: number
  name: string
  amountCents: number
  cardPaidAt: string | null
  paidWithCardOf: number | null
  paidByCheck: boolean
  credit: { amountCents: number, shares: Record<number, number> } | null
  participants: { userId: number, amountCents: number, paidAt: string | null }[]
}

const props = defineProps<{ refunds: Refund[], bills: Bill[], users: { id: number, name: string }[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ changed: [] }>()
const run = useApi()
const busy = ref<string | null>(null)
const target = reactive<Record<number, number | undefined>>({})

const firstName = (id: number) => props.users.find(u => u.id === id)?.name.split(' ')[0] ?? 'Someone'
const sharesText = (r: Refund) => Object.entries(r.shares).map(([id, c]) => `${firstName(Number(id))} ${formatMoney(c)}`).join(' · ')

/** Unpaid shared-card bills this month that can take the whole credit. */
function targets(r: Refund) {
  const credit = { amountCents: r.amountCents, shares: r.shares }
  return props.bills
    .filter(b => b.id !== r.billId && canEditBill(b) && !b.cardPaidAt && onSharedCard(b) && !b.credit && canAbsorb(b, credit))
    .map(b => ({ label: `${b.name} · ${formatMoney(b.amountCents)}`, value: b.id }))
}

async function act(key: string, action: () => Promise<unknown>, success: string) {
  busy.value = key
  const ok = await run(action, success)
  busy.value = null
  if (ok) emit('changed')
}
const apply = (r: Refund) => target[r.id] && act(`apply:${r.id}`, () => $fetch(`/api/refunds/${r.id}/apply`, { method: 'POST', body: { billId: target[r.id] } }), 'Credit applied')
const unapply = (r: Refund) => act(`unapply:${r.id}`, () => $fetch(`/api/refunds/${r.id}/unapply`, { method: 'POST' }), 'Credit is available again')
const remove = (r: Refund) => act(`delete:${r.id}`, () => $fetch(`/api/refunds/${r.id}`, { method: 'DELETE' }), 'Refund deleted')
</script>

<template>
  <UModal v-model:open="open" title="Refund Credits" description="Every refund, where its credit went, and what is still available." :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <p v-if="!refunds.length" class="text-sm text-muted">
        No refunds recorded yet. Use Record Refund on a paid bill.
      </p>
      <ul v-else class="divide-y divide-default">
        <li v-for="r in refunds" :key="r.id" class="py-3 space-y-2">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div class="font-semibold text-highlighted">
                {{ r.billName }}
                <UBadge color="error" variant="soft" class="ms-1">
                  ↩ −{{ formatMoney(r.amountCents) }}
                </UBadge>
              </div>
              <div class="text-xs text-toned">
                Refunded {{ usDotDate(r.refundedOn) }} · bought {{ usDotDate(r.billAddedOn) }} · {{ sharesText(r) }}
              </div>
            </div>
            <div v-if="r.appliedToBillId" class="text-right">
              <UBadge color="secondary" variant="soft">
                ◎ Used on {{ r.appliedToName }}
              </UBadge>
              <div class="text-xs text-toned mt-1">
                {{ r.appliedToAddedOn && usDotDate(r.appliedToAddedOn) }}
              </div>
            </div>
            <UBadge v-else color="secondary" variant="soft">
              ◎ Available
            </UBadge>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <template v-if="!r.appliedToBillId">
              <USelect v-model="target[r.id]" :items="targets(r)" placeholder="Apply to a bill this month…" class="w-72" size="sm" :disabled="!targets(r).length" />
              <UButton size="sm" class="rounded-full" :disabled="!target[r.id]" :loading="busy === `apply:${r.id}`" @click="apply(r)">
                Apply
              </UButton>
              <UButton size="sm" color="error" variant="ghost" class="rounded-full ms-auto" icon="i-lucide-trash-2" :loading="busy === `delete:${r.id}`" @click="remove(r)">
                Delete
              </UButton>
            </template>
            <UButton v-else size="sm" color="neutral" variant="soft" class="rounded-full" :loading="busy === `unapply:${r.id}`" @click="unapply(r)">
              Unapply
            </UButton>
          </div>
        </li>
      </ul>
    </template>
  </UModal>
</template>
