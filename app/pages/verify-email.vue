<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Confirm email' })

const route = useRoute()
const { loggedIn, fetch: refreshSession } = useUserSession()
const status = ref<'working' | 'done' | 'failed'>('working')
const error = ref('')

onMounted(async () => {
  try {
    await $fetch('/api/auth/confirm-email', { method: 'POST', body: { token: String(route.query.token ?? '') } })
    await refreshSession()
    status.value = 'done'
  }
  catch (e) {
    error.value = errorMessage(e)
    status.value = 'failed'
  }
})
</script>

<template>
  <div class="space-y-4 text-center">
    <h1 class="text-lg font-semibold text-highlighted">
      Confirm email
    </h1>
    <p v-if="status === 'working'" class="text-sm text-muted">
      Confirming…
    </p>
    <UAlert v-else-if="status === 'done'" color="success" variant="subtle" title="Your email is confirmed." icon="i-lucide-mail-check" />
    <UAlert v-else color="error" variant="subtle" :title="error" icon="i-lucide-circle-alert" />
    <UButton :to="loggedIn ? '/settings' : '/login'" block variant="soft">
      {{ loggedIn ? 'Back to settings' : 'Sign in' }}
    </UButton>
  </div>
</template>
