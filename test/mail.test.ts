import { describe, expect, it } from 'vitest'
import { renderMailHtml } from '../server/utils/mail'

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
