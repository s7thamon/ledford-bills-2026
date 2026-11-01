<script setup lang="ts">
interface Held { id: number, name: string, amountCents: number, addOn: string }

const props = defineProps<{ held: Held | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ changed: [] }>()
const run = useApi()

const state = reactive({ name: '', amount: '' })
const saving = ref(false)

watch(() => [open.value, props.held] as const, ([isOpen, held]) => {
  if (!isOpen || !held) return
  Object.assign(state, { name: held.name, amount: moneyNumber(held.amountCents) })
}, { immediate: true })

async function save() {
  if (!props.held) return
  saving.value = true
  const ok = await run(() => $fetch(`/api/held-bills/${props.held!.id}`, {
    method: 'PATCH',
    body: { name: state.name, amountCents: parseAmount(state.amount) }
  }), 'Held bill updated')
  saving.value = false
  if (ok) {
    open.value = false
    emit('changed')
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Edit Held Bill" :description="held ? `Added to the bills on ${usDotDate(held.addOn)}, split evenly.` : ''">
    <template #body>
      <form id="edit-held-bill" class="space-y-4" @submit.prevent="save">
        <UFormField label="Name" required>
          <UInput v-model="state.name" class="w-full" />
        </UFormField>
        <UFormField label="Amount" required>
          <UInput v-model="state.amount" icon="i-lucide-dollar-sign" inputmode="decimal" class="w-full" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="soft" @click="open = false">
          Cancel
        </UButton>
        <UButton type="submit" form="edit-held-bill" :loading="saving">
          Save
        </UButton>
      </div>
    </template>
  </UModal>
</template>
