<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Sign in' })

const state = reactive({ email: '', password: '' })
const loading = ref(false)
const error = ref('')
const { fetch: refreshSession } = useUserSession()

async function submit() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch('/api/auth/login', { method: 'POST', body: state })
    if (res.status === 'code') return navigateTo('/login/verify')
    await refreshSession()
    await navigateTo('/')
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
  <UForm :state="state" class="space-y-4" @submit="submit">
    <div>
      <h1 class="text-lg font-semibold text-highlighted">
        Sign in
      </h1>
      <p class="text-sm text-muted">
        Use your household account.
      </p>
    </div>
    <UAlert v-if="error" color="error" variant="subtle" :title="error" icon="i-lucide-circle-alert" />
    <UFormField label="Email" name="email" required>
      <UInput v-model="state.email" type="email" autocomplete="username" autofocus class="w-full" />
    </UFormField>
    <UFormField label="Password" name="password" required>
      <UInput v-model="state.password" type="password" autocomplete="current-password" class="w-full" />
    </UFormField>
    <UButton type="submit" block :loading="loading">
      Sign in
    </UButton>
    <div class="text-center">
      <ULink to="/forgot-password" class="text-sm text-muted hover:text-default">
        Forgot your password?
      </ULink>
    </div>
  </UForm>
</template>
