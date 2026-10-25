<script setup lang="ts">
/** Per-person split inputs. Editing one person's amount re-splits the rest (rounded up). */
const props = defineProps<{
  users: { id: number, name: string }[]
  totalCents: number
  disabled?: boolean
}>()
const splits = defineModel<Record<number, string>>({ required: true })

/** While typing, the field being edited keeps its raw text (so "12." survives); it is normalised on blur. */
function lock(userId: number, typing: boolean) {
  const amounts = splitAmounts(props.totalCents, props.users.map(u => u.id), { userId, amountCents: parseAmount(splits.value[userId]) })
  splits.value = Object.fromEntries(Object.entries(amounts).map(([id, cents]) =>
    [id, typing && Number(id) === userId ? splits.value[userId] ?? '' : moneyNumber(cents)]))
}

const sum = computed(() => props.users.reduce((acc, u) => acc + parseAmount(splits.value[u.id]), 0))
</script>

<template>
  <div class="space-y-3">
    <div class="grid grid-cols-2 gap-3">
      <UFormField v-for="u in users" :key="u.id" :label="`${u.name.split(' ')[0]} Pays`">
        <UInput
          :model-value="splits[u.id]"
          icon="i-lucide-dollar-sign"
          inputmode="decimal"
          :disabled="disabled"
          class="w-full"
          @update:model-value="v => { splits[u.id] = String(v ?? ''); lock(u.id, true) }"
          @change="lock(u.id, false)"
        />
      </UFormField>
    </div>
    <p class="text-xs" :class="sum < totalCents ? 'text-error' : 'text-muted'">
      Splits total {{ formatMoney(sum) }} of {{ formatMoney(totalCents) }}<span v-if="sum < totalCents">: not enough to cover the bill</span>
    </p>
  </div>
</template>
