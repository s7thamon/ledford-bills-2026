import { listUsers } from '../services/users'

export default defineEventHandler(() => listUsers())
