/** Runs a mutation with a success toast, or an error toast with the server's message. */
export function useApi() {
  const toast = useToast()
  return async function run<T>(action: () => Promise<T>, success?: string): Promise<T | undefined> {
    try {
      const result = await action()
      if (success) toast.add({ title: success, color: 'success', icon: 'i-lucide-check' })
      return result
    }
    catch (e) {
      toast.add({ title: errorMessage(e), color: 'error', icon: 'i-lucide-circle-alert' })
    }
  }
}
