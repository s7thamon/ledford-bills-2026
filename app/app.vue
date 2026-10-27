<template>
  <!-- Tooltips open instantly everywhere, like the Edit button's. -->
  <UApp :toaster="{ position: 'bottom-right' }" :tooltip="{ delayDuration: 0 }">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
