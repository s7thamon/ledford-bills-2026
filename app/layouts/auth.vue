<template>
  <div class="min-h-screen flex items-center justify-center bg-muted px-4 py-12">
    <div class="w-full max-w-sm space-y-6">
      <div class="flex items-center justify-center gap-2 text-highlighted">
        <AppLogo class="size-8" />
        <span class="text-lg font-semibold">Ledford Bills</span>
      </div>
      <UCard>
        <slot />
      </UCard>
    </div>
  </div>
</template>
