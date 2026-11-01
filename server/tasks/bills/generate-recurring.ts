import { generateRecurring } from '../../services/recurring'
import { releaseHeldBills } from '../../services/held-bills'

export default defineTask({
  meta: { name: 'bills:generate-recurring', description: 'Generate bills and reimbursements for active recurring templates, then add held bills that are due' },
  async run() {
    const created = await generateRecurring()
    // After the recurring bills, so held bills land below them on the 1st.
    const released = await releaseHeldBills()
    if (created) publish({ topics: ['bills', 'reimbursements'], message: `${created} recurring item${created === 1 ? '' : 's'} added` })
    if (released) publish({ topics: ['bills', 'held-bills'], message: `${released} held bill${released === 1 ? '' : 's'} added` })
    return { result: `Generated ${created} recurring item(s), added ${released} held bill(s).` }
  }
})
