<script setup lang="ts">
interface Use { billId: number, billName: string, billAddedOn: string, amountCents: number, shares: Record<number, number>, removable: boolean }
interface Refund {
  id: number
  billId: number
  billName: string
  billAddedOn: string
  amountCents: number
  refundedOn: string
  shares: Record<number, number>
  left: Record<number, number>
  leftCents: number
  uses: Use[]
}
interface Bill {
  id: number
  name: string
  amountCents: number
  cardPaidAt: string | null
  paidByCheck: boolean
  credit: { amountCents: number, shares: Record<number, number> } | null
  participants: { userId: number, amountCents: number, paidAt: string | null }[]
}

const props = defineProps<{ refunds: Refund[], bills: Bill[], users: { id: number, name: string }[], directPay: string[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ changed: [] }>()
const run = useApi()
const busy = ref<string | null>(null)
const target = ref<number>()

const firstName = (id: number) => props.users.find(u => u.id === id)?.name.split(' ')[0] ?? 'Someone'
const sharesText = (r: Refund) => Object.entries(r.shares).map(([id, c]) => `${firstName(Number(id))} ${formatMoney(c)}`).join(' · ')
const leftCents = computed(() => props.refunds.reduce((s, r) => s + r.leftCents, 0))
/** Credit left on a refund after each of its bites, in order. */
const leftAfter = (r: Refund, i: number) => r.amountCents - r.uses.slice(0, i + 1).reduce((s, u) => s + u.amountCents, 0)

/** This month's bills that can take a bite right now. */
const targets = computed(() => {
  const pools = poolsFromRefunds(props.refunds)
  return props.bills
    .filter(b => canTakeCredit(b, isDirectPayName(b.name, props.directPay)))
    .map(b => ({ bill: b, credit: creditFromPieces(sizeBite(b, pools)) }))
    .filter(t => t.credit.amountCents > 0)
    .map(t => ({ label: `${t.bill.name} · ${formatMoney(t.bill.amountCents)} · uses ${formatMoney(t.credit.amountCents)}`, value: t.bill.id }))
})

async function act(key: string, action: () => Promise<unknown>, success: string) {
  busy.value = key
  const ok = await run(action, success)
  busy.value = null
  if (ok) emit('changed')
  return ok
}
async function apply() {
  if (target.value && await act('apply', () => $fetch(`/api/bills/${target.value}/credit`, { method: 'POST' }), 'Credit applied')) target.value = undefined
}
const remove = (u: Use) => act(`remove:${u.billId}`, () => $fetch(`/api/bills/${u.billId}/credit`, { method: 'DELETE' }), 'Credit is available again')
const removeRefund = (r: Refund) => act(`delete:${r.id}`, () => $fetch(`/api/refunds/${r.id}`, { method: 'DELETE' }), 'Refund deleted')
</script>

<template>
  <UModal v-model:open="open" title="Refund Credits" description="Every refund, which bills used its credit, and what is still left." :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <p v-if="!refunds.length" class="text-sm text-muted">
        No refunds recorded yet. Use Record Refund on a paid bill.
      </p>
      <template v-else>
        <div v-if="leftCents" class="flex flex-wrap items-center gap-2 pb-3 border-b border-default">
          <USelect v-model="target" :items="targets" placeholder="Use on a bill this month…" class="w-80" size="sm" :disabled="!targets.length" />
          <UButton size="sm" class="rounded-full" :disabled="!target" :loading="busy === 'apply'" @click="apply">
            Use Credit
          </UButton>
        </div>
        <ul class="divide-y divide-default">
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
              <div class="text-right">
                <b class="text-violet-700 dark:text-violet-300 tabular-nums">{{ r.leftCents ? `${formatMoney(r.leftCents)} left` : 'Used up' }}</b>
                <div class="text-xs text-toned tabular-nums">
                  of {{ formatMoney(r.amountCents) }}
                </div>
              </div>
            </div>
            <div class="h-1.5 rounded-full bg-violet-100 dark:bg-violet-500/15 overflow-hidden">
              <div class="h-full bg-violet-600 dark:bg-violet-400" :style="{ width: `${(1 - r.leftCents / r.amountCents) * 100}%` }" />
            </div>
            <table v-if="r.uses.length" class="w-full text-sm tabular-nums">
              <thead class="text-xs text-muted">
                <tr>
                  <th class="text-left font-normal py-1">
                    Used on
                  </th>
                  <th v-for="u in users" :key="u.id" class="text-right font-normal">
                    {{ u.name.split(' ')[0] }}
                  </th>
                  <th class="text-right font-normal">
                    Card
                  </th>
                  <th class="text-right font-normal">
                    Left
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="(use, i) in r.uses" :key="use.billId">
                  <td class="py-1">
                    <NuxtLink :to="{ path: '/', query: { month: use.billAddedOn.slice(0, 7) } }" class="hover:underline" @click="open = false">
                      {{ use.billName }} · {{ usDotDate(use.billAddedOn) }}
                    </NuxtLink>
                  </td>
                  <td v-for="u in users" :key="u.id" class="text-right">
                    {{ formatMoney(use.shares[u.id] ?? 0) }}
                  </td>
                  <td class="text-right">
                    {{ formatMoney(use.amountCents) }}
                  </td>
                  <td class="text-right">
                    {{ formatMoney(leftAfter(r, i)) }}
                  </td>
                  <td class="text-right w-px ps-2">
                    <UTooltip v-if="use.removable" text="Takes the credit off this bill (from every refund it used)" :delay-duration="0" :content="{ side: 'top' }">
                      <UButton size="xs" color="neutral" variant="ghost" :loading="busy === `remove:${use.billId}`" @click="remove(use)">
                        Remove
                      </UButton>
                    </UTooltip>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="flex justify-end">
              <UButton size="sm" color="error" variant="ghost" class="rounded-full" icon="i-lucide-trash-2" :loading="busy === `delete:${r.id}`" @click="removeRefund(r)">
                Delete
              </UButton>
            </div>
          </li>
        </ul>
      </template>
    </template>
  </UModal>
</template>
