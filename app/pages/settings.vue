<script setup lang="ts">
useHead({ title: 'Settings' })
const run = useApi()
const toast = useToast()
const { user, fetch: refreshSession } = useUserSession()

const { data: users, refresh: refreshUsers } = await useFetch('/api/users', { key: 'users', default: () => [] })
const { data: devices, refresh: refreshDevices } = await useFetch('/api/settings/devices', { default: () => [] })

// Profile
const profile = reactive({ name: user.value?.name ?? '', email: user.value?.email ?? '' })
const savingProfile = ref(false)
async function saveProfile() {
  savingProfile.value = true
  const res = await run(() => $fetch('/api/settings/profile', { method: 'PUT', body: profile }))
  savingProfile.value = false
  if (!res) return
  await refreshSession()
  toast.add({
    title: res.emailPending ? `Profile saved. Check ${profile.email} to confirm the new email.` : 'Profile saved',
    color: 'success'
  })
  profile.email = user.value?.email ?? profile.email
}

// Password
const pw = reactive({ currentPassword: '', password: '', confirm: '' })
const savingPw = ref(false)
async function savePassword() {
  if (pw.password !== pw.confirm) {
    toast.add({ title: 'New passwords do not match.', color: 'warning' })
    return
  }
  savingPw.value = true
  const ok = await run(() => $fetch('/api/settings/password', { method: 'PUT', body: { currentPassword: pw.currentPassword, password: pw.password } }), 'Password changed')
  savingPw.value = false
  if (ok) Object.assign(pw, { currentPassword: '', password: '', confirm: '' })
}

// Card owner
const cardOwnerId = computed(() => users.value.find(u => u.isCardOwner)?.id)
const userItems = computed(() => users.value.map(u => ({ label: u.name, value: u.id })))
async function setCardOwner(userId: number) {
  if (await run(() => $fetch('/api/settings/card-owner', { method: 'PUT', body: { userId } }), 'Card owner updated')) await refreshUsers()
}

// Devices
async function revoke(id: number) {
  if (await run(() => $fetch(`/api/settings/devices/${id}`, { method: 'DELETE' }), 'Device signed out')) await refreshDevices()
}
function deviceLabel(ua: string | null) {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return [browser, os].filter(Boolean).join(' on ')
}
const fmtDate = (d: string) => new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-8">
    <h1 class="text-2xl font-semibold text-highlighted">
      Settings
    </h1>

    <UCard>
      <template #header>
        <h2 class="font-semibold text-highlighted">
          Profile
        </h2>
      </template>
      <form class="space-y-4" @submit.prevent="saveProfile">
        <UFormField label="Name" required>
          <UInput v-model="profile.name" autocomplete="name" class="w-full" />
        </UFormField>
        <UFormField label="Email" required help="A new email only takes effect after you click the link we send to it.">
          <UInput v-model="profile.email" type="email" autocomplete="email" class="w-full" />
        </UFormField>
        <UButton type="submit" :loading="savingProfile">
          Save profile
        </UButton>
      </form>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold text-highlighted">
          Password
        </h2>
      </template>
      <form class="space-y-4" @submit.prevent="savePassword">
        <UFormField label="Current password" required>
          <UInput v-model="pw.currentPassword" type="password" autocomplete="current-password" class="w-full" />
        </UFormField>
        <UFormField label="New password" required help="At least 12 characters with upper and lower case letters and a number.">
          <UInput v-model="pw.password" type="password" autocomplete="new-password" class="w-full" />
        </UFormField>
        <UFormField label="Confirm new password" required>
          <UInput v-model="pw.confirm" type="password" autocomplete="new-password" class="w-full" />
        </UFormField>
        <UButton type="submit" :loading="savingPw">
          Change password
        </UButton>
      </form>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold text-highlighted">
          Card owner
        </h2>
        <p class="text-sm text-muted">
          Gets the "card ready to pay" email once everyone has paid a bill.
        </p>
      </template>
      <USelect :model-value="cardOwnerId" :items="userItems" placeholder="Nobody" class="w-64" @update:model-value="v => setCardOwner(Number(v))" />
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold text-highlighted">
          Trusted devices
        </h2>
        <p class="text-sm text-muted">
          These skip the emailed sign-in code for 30 days after their last use.
        </p>
      </template>
      <ul v-if="devices.length" class="divide-y divide-default">
        <li v-for="d in devices" :key="d.id" class="flex items-center justify-between gap-4 py-3">
          <div>
            <div class="text-sm font-medium text-highlighted">
              {{ deviceLabel(d.userAgent) }}
              <UBadge v-if="d.current" size="sm" variant="soft" class="ms-1">
                This device
              </UBadge>
            </div>
            <div class="text-xs text-muted">
              Last used {{ fmtDate(d.lastUsedAt) }} · expires {{ fmtDate(d.expiresAt) }}
            </div>
          </div>
          <UButton size="sm" color="error" variant="ghost" icon="i-lucide-log-out" @click="revoke(d.id)">
            Forget
          </UButton>
        </li>
      </ul>
      <p v-else class="text-sm text-muted">
        No trusted devices.
      </p>
    </UCard>
  </div>
</template>
