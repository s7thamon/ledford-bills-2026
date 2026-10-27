import { unpaidByMonth } from '../../services/bills'

// The 12 months the History menu lists.
export default defineEventHandler(() => unpaidByMonth(shiftMonth(currentMonth(), -12), shiftMonth(currentMonth(), -1)))
