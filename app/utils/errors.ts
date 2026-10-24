/** Human message from a $fetch error, including the first zod validation issue. */
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  const e = error as { data?: { statusMessage?: string, message?: string, data?: { issues?: { message: string }[] } }, statusMessage?: string }
  return e?.data?.data?.issues?.[0]?.message
    ?? e?.data?.statusMessage
    ?? e?.data?.message
    ?? e?.statusMessage
    ?? fallback
}
