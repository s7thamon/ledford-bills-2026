<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Forgot password' })

const email = ref('')
const loading = ref(false)
const sent = ref(false)
const error = ref('')

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/forgot-password', { method: 'POST', body: { email: email.value } })
    sent.value = true
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
        Forgot your password?
      </h1>
      <p class="text-sm text-muted">
        We will email you a reset link.
      </p>
    </div>
    <UAlert v-if="sent" color="success" variant="subtle" title="If that email has an account, a reset link is on its way." icon="i-lucide-mail-check" />
    <UAlert v-if="error" color="error" variant="subtle" :title="error" icon="i-lucide-circle-alert" />
    <UFormField label="Email" required>
      <UInput v-model="email" type="email" autocomplete="username" autofocus class="w-full" />
    </UFormField>
    <UButton type="submit" block :loading="loading">
      Email reset link
    </UButton>
    <div class="text-center">
      <ULink to="/login" class="text-sm text-muted hover:text-default">
        Back to sign in
      </ULink>
    </div>
  </form>
</template>
