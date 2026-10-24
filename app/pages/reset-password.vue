<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Reset password' })

const route = useRoute()
const state = reactive({ password: '', confirm: '' })
const loading = ref(false)
const error = ref('')
const toast = useToast()

async function submit() {
  error.value = ''
  if (state.password !== state.confirm) {
    error.value = 'Passwords do not match.'
    return
  }
  loading.value = true
  try {
    await $fetch('/api/auth/reset-password', { method: 'POST', body: { token: String(route.query.token ?? ''), password: state.password } })
    toast.add({ title: 'Password reset. Please sign in.', color: 'success' })
    await navigateTo('/login')
  }
  catch (e) {
    error.value = errorMessage(e)
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <div>
      <h1 class="text-lg font-semibold text-highlighted">
        Choose a new password
      </h1>
      <p class="text-sm text-muted">
        At least 12 characters with upper and lower case letters and a number.
      </p>
    </div>
    <UAlert v-if="error" color="error" variant="subtle" :title="error" icon="i-lucide-circle-alert" />
    <UFormField label="New password" required>
      <UInput v-model="state.password" type="password" autocomplete="new-password" autofocus class="w-full" />
    </UFormField>
    <UFormField label="Confirm password" required>
      <UInput v-model="state.confirm" type="password" autocomplete="new-password" class="w-full" />
    </UFormField>
    <UButton type="submit" block :loading="loading">
      Reset password
    </UButton>
  </form>
</template>
