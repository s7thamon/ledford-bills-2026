import { countUnpaidInMonth } from '../../services/bills'
import { unpaidReminder } from '../../services/notify'

export default defineTask({
  meta: { name: 'bills:unpaid-reminder', description: 'Email everyone when last month still has unpaid bills' },
  async run() {
    const month = shiftMonth(currentMonth(), -1)
    const unpaid = await countUnpaidInMonth(month)
    if (unpaid) await unpaidReminder(month, unpaid)
    return { result: `${unpaid} unpaid bill(s) in ${month}.` }
  }
})
