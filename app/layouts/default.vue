<script setup lang="ts">
import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui'

const route = useRoute()
const { user, session, clear, fetch: refreshSession } = useUserSession()
const { connected, disconnect } = useLive()
const toast = useToast()

const thisMonth = currentMonth()
const historyMonths = Array.from({ length: 12 }, (_, i) => shiftMonth(thisMonth, -(i + 1)))

const nav = computed<NavigationMenuItem[]>(() => [
  { label: 'Bills', icon: 'i-lucide-banknote', to: '/', active: route.path === '/' && (!route.query.month || route.query.month === thisMonth) },
  {
    label: 'History',
    icon: 'i-lucide-calendar-days',
    active: route.path === '/' && !!route.query.month && route.query.month !== thisMonth,
    children: historyMonths.map(m => ({ label: monthLabel(m), to: { path: '/', query: { month: m } } }))
  },
  { label: 'Recurring', icon: 'i-lucide-repeat', to: '/recurring' },
  { label: 'Reimbursements', icon: 'i-lucide-arrow-left-right', to: '/reimbursements' }
])

const search = ref(String(route.query.q ?? ''))
function submitSearch() {
  navigateTo({ path: '/search', query: search.value ? { q: search.value } : {} })
}

const adminMode = computed(() => !!session.value?.adminMode)
async function toggleAdmin() {
  await $fetch('/api/admin-mode', { method: 'PUT', body: { enabled: !adminMode.value } })
  await refreshSession()
  toast.add({ title: adminMode.value ? 'Admin mode on' : 'Admin mode off', icon: adminMode.value ? 'i-lucide-lock-open' : 'i-lucide-lock' })
}

const initials = computed(() => (user.value?.name ?? '').split(' ').slice(0, 2).map(w => w[0]).join(''))

const userMenu = computed<DropdownMenuItem[][]>(() => [
  [{ label: user.value?.name ?? '', type: 'label' }],
  [{ label: 'Settings', icon: 'i-lucide-settings', to: '/settings' }],
  [{
    label: 'Sign out',
    icon: 'i-lucide-log-out',
    onSelect: async () => {
      disconnect()
      await $fetch('/api/auth/logout', { method: 'POST' })
      await clear()
      await navigateTo('/login')
    }
  }]
])
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <UHeader mode="modal" :ui="{ container: 'max-w-(--ui-container)' }">
      <template #title>
        <AppLogo class="size-8" />
        <span class="sr-only">Ledford Bills</span>
      </template>

      <UNavigationMenu :items="nav" variant="link" />

      <template #right>
        <form class="hidden md:block" @submit.prevent="submitSearch">
          <UInput v-model="search" icon="i-lucide-search" placeholder="Search bills" class="w-52" aria-label="Search bills" />
        </form>
        <UTooltip :text="adminMode ? 'Admin mode on: you can mark anyone paid' : 'Admin mode'">
          <UButton
            :icon="adminMode ? 'i-lucide-lock-open' : 'i-lucide-lock'"
            :color="adminMode ? 'primary' : 'neutral'"
            :variant="adminMode ? 'soft' : 'ghost'"
            :aria-pressed="adminMode"
            aria-label="Toggle admin mode"
            @click="toggleAdmin"
          />
        </UTooltip>
        <UTooltip :text="connected ? 'Live updates on' : 'Reconnecting…'">
          <span class="size-2 rounded-full" :class="connected ? 'bg-success' : 'bg-warning animate-pulse'" />
        </UTooltip>
        <UDropdownMenu :items="userMenu" :content="{ align: 'end' }">
          <UButton color="neutral" variant="ghost" trailing-icon="i-lucide-chevrons-up-down" aria-label="User menu">
            <UAvatar :text="initials" size="xs" />
          </UButton>
        </UDropdownMenu>
      </template>

      <template #body>
        <form class="mb-4" @submit.prevent="submitSearch">
          <UInput v-model="search" icon="i-lucide-search" placeholder="Search bills" class="w-full" aria-label="Search bills" />
        </form>
        <UNavigationMenu :items="nav" orientation="vertical" class="-mx-2.5" />
      </template>
    </UHeader>

    <UMain>
      <UContainer class="py-8">
        <slot />
      </UContainer>
    </UMain>
  </div>
</template>
