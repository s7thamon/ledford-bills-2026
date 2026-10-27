import { beforeEach, describe, expect, it } from 'vitest'
import { createReimbursement, deleteReimbursement, listReimbursements, markReimbursementComplete, markTransferComplete, updateReimbursement } from '../server/services/reimbursements'
import { sentMail } from '../server/utils/mail'
import { expectHttpError, flushMail, resetDb, seedUsers } from './helpers'

let tim: number, kelly: number

beforeEach(async () => {
  await resetDb()
  ;({ tim, kelly } = await seedUsers())
})

describe('reimbursements', () => {
  it('searches by name or amount', async () => {
    await createReimbursement({ name: 'Concert', owedCents: 2680, createdBy: tim })
    await createReimbursement({ name: 'Gas', owedCents: 1234, createdBy: tim })
    const names = async (q: string) => (await listReimbursements({ resolved: false, page: 1, sort: 'name', dir: 'asc', q })).items.map(r => r.name)
    expect(await names('conc')).toEqual(['Concert'])
    expect(await names('$26.8')).toEqual(['Concert'])
    expect(await names('12.34')).toEqual(['Gas'])
    expect((await listReimbursements({ resolved: false, page: 1, sort: 'name', dir: 'asc' })).openOwedTo).toEqual({ [tim]: 3914 })
  })

  it('assigns the other user and emails both sides', async () => {
    const r = await createReimbursement({ name: 'Concert', owedCents: 5000, createdBy: tim, notes: 'Row F' })
    expect(r.otherUserId).toBe(kelly)
    await flushMail()
    expect(sentMail.map(m => m.to).sort()).toEqual(['kelly@example.com', 'tim@example.com'])
  })

  it('walks awaiting, sent, received with the right people', async () => {
    const r = await createReimbursement({ name: 'Gas', owedCents: 2500, createdBy: tim })
    await expectHttpError(markTransferComplete(r.id, tim), 403)
    await expectHttpError(markReimbursementComplete(r.id, tim), 403)
    await markTransferComplete(r.id, kelly)
    await expectHttpError(updateReimbursement(r.id, tim, { name: 'Gas', owedCents: 1 }), 403)
    await expectHttpError(markReimbursementComplete(r.id, kelly), 403)
    await markReimbursementComplete(r.id, tim)

    expect((await listReimbursements({ resolved: false, page: 1, sort: 'createdAt', dir: 'desc' })).total).toBe(0)
    expect((await listReimbursements({ resolved: true, page: 1, sort: 'status', dir: 'asc' })).total).toBe(1)
  })

  it('lets admin mode act for the other person', async () => {
    const r = await createReimbursement({ name: 'Tolls', owedCents: 900, createdBy: tim })
    await markTransferComplete(r.id, tim, true)
    await markReimbursementComplete(r.id, kelly, true)
  })

  it('only the creator edits or deletes, before payment', async () => {
    const r = await createReimbursement({ name: 'Lunch', owedCents: 1200, createdBy: tim })
    await expectHttpError(deleteReimbursement(r.id, kelly), 403)
    expect((await updateReimbursement(r.id, tim, { name: 'Lunch', owedCents: 1300, notes: '  ' })).notes).toBeNull()
    await deleteReimbursement(r.id, tim)
  })

  it('paginates ten at a time', async () => {
    for (let i = 0; i < 12; i++) await createReimbursement({ name: `R${i}`, owedCents: 100 + i, createdBy: tim })
    const page2 = await listReimbursements({ resolved: false, page: 2, sort: 'owedCents', dir: 'asc' })
    expect(page2.total).toBe(12)
    expect(page2.items.map(r => r.owedCents)).toEqual([110, 111])
  })
})
