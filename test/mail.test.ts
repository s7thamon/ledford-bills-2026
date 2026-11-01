import { describe, expect, it } from 'vitest'
import { queueMail, renderMailHtml, sentMail } from '../server/utils/mail'
import { flushMail } from './helpers'

describe('mail queue', () => {
  it('sends in the order queued', async () => {
    sentMail.length = 0
    for (const subject of ['Mortgage', 'Principal', 'Netflix']) queueMail({ to: 'tim@example.com', subject, lines: [] })
    await flushMail()
    expect(sentMail.map(m => m.subject)).toEqual(['Mortgage', 'Principal', 'Netflix'])
  })
})

describe('mail html', () => {
  const html = renderMailHtml({
    to: 'tim@example.com',
    subject: 'New Bill Added - "Rent"',
    lines: ['A new bill has been added.', 'Bill: Rent <b>', 'Total Amount: $200.00'],
    action: { label: 'View Bill', url: 'https://bills.example/?month=2026-10' }
  })

  it('uses the subject as heading and the plain line as intro', () => {
    expect(html).toContain('New Bill Added - &quot;Rent&quot;')
    expect(html).toContain('A new bill has been added.')
  })
  it('turns "Label: value" lines into a details table, escaped', () => {
    expect(html).toMatch(/>Bill<\/td>\s*<td[^>]*>Rent &lt;b&gt;<\/td>/)
    expect(html).toMatch(/>Total Amount<\/td>\s*<td[^>]*>\$200\.00<\/td>/)
    expect(html).not.toContain('<b>')
  })
  it('renders the action button', () => {
    expect(html).toContain('href="https://bills.example/?month=2026-10"')
    expect(html).toContain('View Bill')
  })
})
