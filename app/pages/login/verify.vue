<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Check your email' })

const code = ref<number[]>([])
const loading = ref(false)
const error = ref('')
const toast = useToast()
const { fetch: refreshSession } = useUserSession()

async function submit() {
  if (code.value.join('').length !== 6) return
  loading.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/verify-code', { method: 'POST', body: { code: code.value.join('') } })
    await refreshSession()
    await navigateTo('/')
  }
  catch (e) {
    error.value = errorMessage(e)
    code.value = []
  }
  finally {
    loading.value = false
  }
}

async function resend() {
  try {
    await $fetch('/api/auth/resend-code', { method: 'POST' })
    toast.add({ title: 'A new code is on its way', color: 'success' })
  }
  catch (e) {
    error.value = errorMessage(e)
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <div>
      <h1 class="text-lg font-semibold text-highlighted">
        Check your email
      </h1>
      <p class="text-sm text-muted">
        We sent a 6-digit code. This device will be remembered for 4 months.
      </p>
    </div>
    <UAlert v-if="error" color="error" variant="subtle" :title="error" icon="i-lucide-circle-alert" />
    <div class="flex justify-center">
      <UPinInput v-model="code" :length="6" otp type="number" autofocus size="xl" @complete="submit" />
    </div>
    <UButton type="submit" block :loading="loading">
      Verify
    </UButton>
    <div class="flex justify-between text-sm">
      <ULink to="/login" class="text-muted hover:text-default">
        Back to sign in
      </ULink>
      <button type="button" class="text-muted hover:text-default" @click="resend">
        Resend code
      </button>
    </div>
  </form>
</template>
