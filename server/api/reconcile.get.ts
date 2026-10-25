import { z } from 'zod'
import { listForReconcile } from '../services/bills'

const Query = z.object({ from: z.iso.date(), to: z.iso.date() })

// Read-only: the CSV itself never reaches the server.
export default defineEventHandler(async (event) => {
  const { from, to } = await getValidatedQuery(event, Query.parse)
  return listForReconcile(from, to)
})
