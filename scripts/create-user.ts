/**
 * Adds a household member. Public registration is disabled.
 *   npm run user:create -- "Tim Hamon" tim@example.com
 * The password is read from USER_PASSWORD or prompted for.
 */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { createUser, findUserByEmail } from '../server/services/auth'
import { newPasswordSchema } from '../shared/utils/validation'

const [name, email] = process.argv.slice(2)
if (!name || !email) {
  console.error('Usage: npm run user:create -- "Full Name" email@example.com')
  process.exit(1)
}

let password = process.env.USER_PASSWORD
if (!password) {
  const rl = createInterface({ input: stdin, output: stdout })
  password = await rl.question('Password: ')
  rl.close()
}

const check = newPasswordSchema.safeParse(password)
if (!check.success) {
  console.error(check.error.issues.map(i => i.message).join('\n'))
  process.exit(1)
}
if (await findUserByEmail(email)) {
  console.error(`A user with ${email} already exists.`)
  process.exit(1)
}

const id = await createUser({ name, email, password })
console.log(`Created user #${id} ${name} <${email}>`)
process.exit(0)
