import { generateRecurring } from '../../services/recurring'

export default defineTask({
  meta: { name: 'bills:generate-recurring', description: 'Generate bills and reimbursements for active recurring templates' },
  async run() {
    const created = await generateRecurring()
    if (created) publish({ topics: ['bills', 'reimbursements'], message: `${created} recurring item${created === 1 ? '' : 's'} added` })
    return { result: `Generated ${created} recurring item(s).` }
  }
})
