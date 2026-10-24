const GUEST_PAGES = ['/login', '/login/verify', '/forgot-password', '/reset-password']

export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  if (to.path === '/verify-email') return
  if (GUEST_PAGES.includes(to.path)) {
    if (loggedIn.value) return navigateTo('/')
    return
  }
  if (!loggedIn.value) return navigateTo('/login')
})
