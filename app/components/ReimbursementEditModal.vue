<script setup lang="ts">
interface Reimbursement { id: number, name: string, owedCents: number, notes: string | null }

const props = defineProps<{ item: Reimbursement | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ changed: [] }>()
const run = useApi()

const state = reactive({ name: '', owed: '', notes: '' })
const saving = ref(false)
const confirmDelete = ref(false)

watch(() => [open.value, props.item] as const, ([isOpen, item]) => {
  if (!isOpen || !item) return
  Object.assign(state, { name: item.name, owed: moneyNumber(item.owedCents), notes: item.notes ?? '' })
  confirmDelete.value = false
}, { immediate: true })

async function save() {
  if (!props.item) return
  saving.value = true
  const ok = await run(() => $fetch(`/api/reimbursements/${props.item!.id}`, {
    method: 'PUT',
    body: { name: state.name, owedCents: parseAmount(state.owed), notes: state.notes }
  }), 'Reimbursement updated')
  saving.value = false
  if (ok) {
    open.value = false
    emit('changed')
  }
}

async function remove() {
  if (!props.item) return
  const ok = await run(() => $fetch(`/api/reimbursements/${props.item!.id}`, { method: 'DELETE' }), 'Reimbursement deleted')
  if (ok) {
    open.value = false
    emit('changed')
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Edit Reimbursement">
    <template #body>
      <form id="edit-reimbursement" class="space-y-4" @submit.prevent="save">
        <UFormField label="Name" required>
          <UInput v-model="state.name" class="w-full" />
        </UFormField>
        <UFormField label="Amount Owed" required>
          <UInput v-model="state.owed" icon="i-lucide-dollar-sign" inputmode="decimal" class="w-full" />
        </UFormField>
        <UFormField label="Notes" hint="Optional">
          <UTextarea v-model="state.notes" :rows="3" :maxlength="2000" class="w-full" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full items-center gap-2">
        <UButton v-if="!confirmDelete" color="error" variant="outline" icon="i-lucide-trash-2" @click="confirmDelete = true">
          Delete
        </UButton>
        <UButton v-else color="error" icon="i-lucide-trash-2" @click="remove">
          Confirm delete
        </UButton>
        <div class="flex-1" />
        <UButton color="neutral" variant="soft" @click="open = false">
          Cancel
        </UButton>
        <UButton type="submit" form="edit-reimbursement" :loading="saving">
          Save
        </UButton>
      </div>
    </template>
  </UModal>
</template>
