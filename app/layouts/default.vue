<script setup lang="ts">
import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui'
import { NavigationMenuLink } from 'reka-ui'

const route = useRoute()
const { user, session, clear, fetch: refreshSession } = useUserSession()
const { connected, disconnect } = useLive()
const toast = useToast()

const thisMonth = currentMonth()
const historyMonths = Array.from({ length: 12 }, (_, i) => shiftMonth(thisMonth, -(i + 1)))

const { data: unpaid, refresh: refreshUnpaid } = await useFetch('/api/bills/unpaid-months', { key: 'bills-badge', default: () => ({}) as Record<string, number> })
const { data: waiting, refresh: refreshWaiting } = await useFetch('/api/reimbursements/waiting', { key: 'reimbursements-badge', default: () => 0 })
// Acting on those pages refreshes their own data; follow it so the menu badges stay current.
watch(useNuxtData('bills').data, () => refreshUnpaid())
watch(useNuxtData('reimbursements').data, () => refreshWaiting())

const nav = computed<NavigationMenuItem[]>(() => [
  { label: 'Bills', icon: 'i-lucide-banknote', to: '/', active: route.path === '/' && (!route.query.month || route.query.month === thisMonth) },
  {
    label: 'History',
    icon: 'i-lucide-calendar-days',
    slot: 'history' as const,
    active: route.path === '/' && !!route.query.month && route.query.month !== thisMonth,
    children: historyMonths.map(m => ({ label: monthLabel(m), to: { path: '/', query: { month: m } }, badge: unpaid.value[m] ? `${unpaid.value[m]} Unpaid` : undefined }))
  },
  { label: 'Recurring', icon: 'i-lucide-repeat', to: '/recurring' },
  { label: 'Reimbursements', icon: 'i-lucide-arrow-left-right', to: '/reimbursements', badge: waiting.value ? { label: String(waiting.value), color: 'warning' as const, variant: 'solid' as const, size: 'sm' as const } : undefined },
  { label: 'Reconcile', icon: 'i-lucide-scale', to: '/reconcile' },
  { label: 'Insights', icon: 'i-lucide-chart-column', to: '/insights' }
])

const colorMode = useColorMode()
const themeIcon = computed(() => ({ light: 'i-lucide-sun', dark: 'i-lucide-moon', system: 'i-lucide-monitor' })[colorMode.preference] ?? 'i-lucide-sun')
const themeMenu = computed<DropdownMenuItem[]>(() => (['light', 'dark', 'system'] as const).map(mode => ({
  label: mode[0]!.toUpperCase() + mode.slice(1),
  icon: { light: 'i-lucide-sun', dark: 'i-lucide-moon', system: 'i-lucide-monitor' }[mode],
  type: 'checkbox',
  checked: colorMode.preference === mode,
  onSelect: () => (colorMode.preference = mode)
})))

const search = ref(String(route.query.q ?? ''))
const searchInput = useTemplateRef('searchInput')
// usingInput: the bill-name field is autofocused, so the shortcut must work from inside inputs.
defineShortcuts({ meta_k: { usingInput: true, handler: () => searchInput.value?.inputRef?.focus() } })
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
    label: 'Sign Out',
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
    <UHeader mode="modal" :ui="{ container: 'max-w-(--ui-container)', left: 'lg:flex-none gap-6', center: 'hidden' }">
      <template #left>
        <NuxtLink to="/" class="flex items-center gap-2 shrink-0 font-bold text-lg text-highlighted">
          <AppLogo class="size-8" />
          Ledford Bills
        </NuxtLink>
        <UNavigationMenu :items="nav" variant="link" class="hidden lg:flex" :ui="{ link: 'rounded-full px-3 py-2 data-active:bg-primary/10', viewport: 'sm:w-72' }">
          <template #history-content>
            <ul class="grid gap-0.5 p-2">
              <li v-for="m in historyMonths" :key="m">
                <NavigationMenuLink as-child>
                  <ULink :to="{ path: '/', query: { month: m } }" class="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-default hover:bg-elevated/70 transition-colors" active-class="text-primary font-medium">
                    {{ monthLabel(m) }}
                    <span v-if="unpaid[m]" class="flex items-center gap-1.5 text-xs text-muted">
                      <UBadge :label="String(unpaid[m])" color="warning" variant="soft" size="sm" />
                      Unpaid
                    </span>
                  </ULink>
                </NavigationMenuLink>
              </li>
            </ul>
          </template>
        </UNavigationMenu>
      </template>

      <template #right>
        <form class="hidden md:block" @submit.prevent="submitSearch">
          <UInput ref="searchInput" v-model="search" icon="i-lucide-search" placeholder="Search All Bills" class="w-60" :ui="{ base: 'rounded-full' }" aria-label="Search All Bills">
            <template #trailing>
              <UKbd value="meta" />
              <UKbd value="k" />
            </template>
          </UInput>
        </form>
        <!-- The saved preference lives in localStorage, so the server can't render the right icon. -->
        <ClientOnly>
          <UDropdownMenu :items="themeMenu" :content="{ align: 'end' }">
            <UTooltip text="Theme" :content="{ side: 'bottom' }">
              <UButton :icon="themeIcon" color="neutral" variant="ghost" class="rounded-full" :aria-label="`Theme: ${colorMode.preference}`" />
            </UTooltip>
          </UDropdownMenu>
          <template #fallback>
            <div class="size-9" />
          </template>
        </ClientOnly>
        <UTooltip :text="adminMode ? 'Admin Mode On · You Can Mark Anyone Paid' : 'Admin Mode'" :content="{ side: 'bottom' }">
          <UButton
            :icon="adminMode ? 'i-lucide-lock-open' : 'i-lucide-lock'"
            :color="adminMode ? 'primary' : 'neutral'"
            :variant="adminMode ? 'soft' : 'ghost'"
            class="rounded-full"
            :aria-pressed="adminMode"
            aria-label="Toggle admin mode"
            @click="toggleAdmin"
          />
        </UTooltip>
        <UDropdownMenu :items="userMenu" :content="{ align: 'end' }">
          <UButton color="neutral" variant="ghost" class="rounded-full p-1" :aria-label="`User menu, ${connected ? 'live updates on' : 'reconnecting'}`">
            <UTooltip :text="connected ? 'Live Updates On' : 'Reconnecting…'" :content="{ side: 'bottom' }">
              <UChip :color="connected ? 'success' : 'warning'" position="bottom-right" inset>
                <UAvatar :text="initials" size="sm" class="bg-primary/10 text-primary font-semibold" />
              </UChip>
            </UTooltip>
          </UButton>
        </UDropdownMenu>
      </template>

      <template #body>
        <form class="mb-4" @submit.prevent="submitSearch">
          <UInput v-model="search" icon="i-lucide-search" placeholder="Search All Bills" class="w-full" aria-label="Search All Bills" />
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
