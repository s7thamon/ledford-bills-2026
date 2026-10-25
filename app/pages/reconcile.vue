<script setup lang="ts">
import type { ReconcileBill, ReconcileRefund, StatementLine } from '#shared/utils/reconcile'

useHead({ title: 'Reconcile' })
const run = useApi()
const toast = useToast()
const { data: users } = await useFetch('/api/users', { key: 'users', default: () => [] })

// Everything below lives in memory only; leaving the page forgets it and the CSV is never uploaded.
type ChargeMatch = { kind: 'auto' | 'confirmed' | 'manual', lineIds: string[], billId: number }
type RefundMatch = { lineId: string, refundId: number }
type PaymentMatch = { kind: 'auto' | 'confirmed' | 'manual', lineId: string, billIds: number[] }

const fileName = ref('')
const range = ref({ from: '', to: '' })
const lines = ref<StatementLine[]>([])
const bills = ref<ReconcileBill[]>([])
const refunds = ref<ReconcileRefund[]>([])
const loading = ref(false)

const matches = ref<ChargeMatch[]>([])
const refundMatches = ref<RefundMatch[]>([])
const suggestions = ref<{ lineIds: string[], billId: number }[]>([])
const assigned = ref<Record<number, string[]>>({})
const ignored = ref<string[]>([])
const dismissed = ref<string[]>([])
const history = ref<string[]>([])

const pMatches = ref<PaymentMatch[]>([])
const pSuggestions = ref<{ lineId: string, billIds: number[] }[]>([])
const pChecks = ref<Record<string, number[]>>({})
const pDismissed = ref<string[]>([])

const lineById = computed(() => new Map(lines.value.map(l => [l.id, l])))
const billById = computed(() => new Map(bills.value.map(b => [b.id, b])))
const line = (id: string) => lineById.value.get(id)!
const bill = (id: number) => billById.value.get(id)
const sum = (ids: string[]) => ids.reduce((s, id) => s + (lineById.value.get(id)?.amountCents ?? 0), 0)
const suggestionKey = (s: { lineIds: string[], billId: number }) => `${s.billId}:${s.lineIds.join(',')}`
const pSuggestionKey = (s: { lineId: string, billIds: number[] }) => `${s.lineId}:${s.billIds.join(',')}`

async function onFile(file: File | null | undefined) {
  if (!file) return
  try {
    const parsed = parseCitiCsv(await file.text())
    fileName.value = file.name
    lines.value = parsed.lines
    range.value = { from: parsed.from, to: parsed.to }
    matches.value = []
    pMatches.value = []
    assigned.value = {}
    ignored.value = []
    dismissed.value = []
    pDismissed.value = []
    pChecks.value = {}
    history.value = []
    await reload()
  }
  catch (e) {
    toast.add({ title: (e as Error).message, color: 'error', icon: 'i-lucide-file-x' })
  }
}

function startOver() {
  fileName.value = ''
  lines.value = []
  bills.value = []
  refunds.value = []
}

/** Fetch app data for the statement range and match again, keeping what a person already decided. */
async function reload() {
  loading.value = true
  const data = await run(() => $fetch('/api/reconcile', { query: range.value }))
  loading.value = false
  if (!data) return
  bills.value = data.bills
  refunds.value = data.refunds
  // Snapshots may point at bills that changed or left the range.
  history.value = []
  rematch()
}

function rematch() {
  const billIds = new Set(bills.value.map(b => b.id))
  const keep = matches.value.filter(m => m.kind !== 'auto' && billIds.has(m.billId))
  assigned.value = Object.fromEntries(Object.entries(assigned.value).filter(([id]) => billIds.has(Number(id))))
  const takenLines = new Set([...keep.flatMap(m => m.lineIds), ...Object.values(assigned.value).flat(), ...ignored.value])
  const takenBills = new Set([...keep.map(m => m.billId), ...Object.keys(assigned.value).map(Number)])
  const r = matchCharges(lines.value.filter(l => !takenLines.has(l.id)), bills.value.filter(b => !takenBills.has(b.id)), refunds.value)
  matches.value = [...keep, ...r.exact.map(m => ({ kind: 'auto' as const, ...m }))]
  refundMatches.value = r.refunds
  suggestions.value = r.suggestions.filter(s => !dismissed.value.includes(suggestionKey(s)))

  const pKeep = pMatches.value.filter(m => m.kind !== 'auto' && m.billIds.every(id => billIds.has(id)))
  const pTakenBills = new Set(pKeep.flatMap(m => m.billIds))
  const pTakenLines = new Set(pKeep.map(m => m.lineId))
  const p = matchPayments(lines.value.filter(l => !pTakenLines.has(l.id)), bills.value.filter(b => !pTakenBills.has(b.id)))
  pMatches.value = [...pKeep, ...p.exact.map(m => ({ kind: 'auto' as const, ...m }))]
  pSuggestions.value = p.suggestions.filter(s => !pDismissed.value.includes(pSuggestionKey(s)))
}

// ---- Charges & refunds ----
const usedLineIds = computed(() => new Set([
  ...matches.value.flatMap(m => m.lineIds),
  ...refundMatches.value.map(m => m.lineId),
  ...suggestions.value.flatMap(s => s.lineIds),
  ...Object.values(assigned.value).flat(),
  ...ignored.value
]))
const leftoverLines = computed(() => lines.value.filter(l => l.kind !== 'payment' && !usedLineIds.value.has(l.id)))
const matchedBillIds = computed(() => new Set([...matches.value.map(m => m.billId), ...suggestions.value.map(s => s.billId)]))
const leftoverBills = computed(() => bills.value.filter(b => b.addedOn >= shift(range.value.from, -5) && b.addedOn <= shift(range.value.to, 5) && !matchedBillIds.value.has(b.id)))

const inRange = (d: string) => d >= range.value.from && d <= range.value.to
const statementTotal = computed(() => lines.value.filter(l => l.kind !== 'payment').reduce((s, l) => s + l.amountCents, 0))
const appTotal = computed(() => bills.value.filter(b => inRange(b.addedOn)).reduce((s, b) => s + b.amountCents, 0)
  - refunds.value.filter(r => inRange(r.refundedOn)).reduce((s, r) => s + r.amountCents, 0))
const offBy = computed(() => leftoverLines.value.reduce((s, l) => s + l.amountCents, 0)
  + Object.values(assigned.value).reduce((s, ids) => s + sum(ids), 0)
  // Bills dated outside the statement are shown (they may match a nearby line) but may simply not have posted yet.
  - leftoverBills.value.filter(b => inRange(b.addedOn)).reduce((s, b) => s + b.amountCents, 0))
const autoCount = computed(() => matches.value.filter(m => m.kind === 'auto').length + refundMatches.value.length + pMatches.value.filter(m => m.kind === 'auto').length)
const needsYou = computed(() => leftoverLines.value.length + leftoverBills.value.length + suggestions.value.length + pLeftoverLines.value.length + pSuggestions.value.length)

function snapshot() {
  history.value.push(JSON.stringify({ matches: matches.value, assigned: assigned.value, ignored: ignored.value, suggestions: suggestions.value, dismissed: dismissed.value }))
}
function undo() {
  const last = history.value.pop()
  if (!last) return
  const s = JSON.parse(last)
  matches.value = s.matches
  assigned.value = s.assigned
  ignored.value = s.ignored
  suggestions.value = s.suggestions
  dismissed.value = s.dismissed
}

const selected = ref<string[]>([])
const toggleSelect = (id: string) => (selected.value = selected.value.includes(id) ? selected.value.filter(x => x !== id) : [...selected.value, id])
const dragOver = ref<number | null>(null)

function assignTo(billId: number, ids = selected.value) {
  const lineIds = ids.filter(id => line(id)?.kind === 'charge')
  if (!lineIds.length) return
  snapshot()
  const pieces = [...(assigned.value[billId] ?? []), ...lineIds]
  selected.value = []
  if (sum(pieces) === bill(billId)!.amountCents) {
    const { [billId]: _, ...rest } = assigned.value
    assigned.value = rest
    matches.value = [...matches.value, { kind: 'manual', lineIds: pieces, billId }]
  }
  else {
    assigned.value = { ...assigned.value, [billId]: pieces }
  }
}
function sendBack(billId: number, lineId: string) {
  snapshot()
  const pieces = (assigned.value[billId] ?? []).filter(id => id !== lineId)
  const { [billId]: _, ...rest } = assigned.value
  assigned.value = pieces.length ? { ...rest, [billId]: pieces } : rest
}
function confirmSuggestion(s: { lineIds: string[], billId: number }) {
  snapshot()
  suggestions.value = suggestions.value.filter(x => x !== s)
  matches.value = [...matches.value, { kind: 'confirmed', ...s }]
}
function dismissSuggestion(s: { lineIds: string[], billId: number }) {
  snapshot()
  dismissed.value = [...dismissed.value, suggestionKey(s)]
  suggestions.value = suggestions.value.filter(x => x !== s)
}
function unmatch(m: ChargeMatch) {
  snapshot()
  matches.value = matches.value.filter(x => x !== m)
}
function ignore(id: string) {
  snapshot()
  ignored.value = [...ignored.value, id]
}

// ---- Actions that change data ----
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
async function addAsBill(l: StatementLine) {
  const created = await run(() => $fetch('/api/bills', { method: 'POST', body: { name: titleCase(storeKey(l.description) || l.description).slice(0, 255), amountCents: l.amountCents, addedOn: l.date } }), 'Bill added')
  if (!created) return
  await reload()
  if (!matches.value.some(m => m.billId === created.id)) matches.value = [...matches.value, { kind: 'manual', lineIds: [l.id], billId: created.id }]
}

const refundTargets = computed(() => bills.value.map(b => ({ label: `${b.name} · ${formatMoney(b.amountCents)} · ${usDotDate(b.addedOn)}`, value: b.id })))
const refundOpen = ref(false)
type RefundBill = { id: number, name: string, amountCents: number, addedOn: string, participants: { userId: number, amountCents: number }[], refunds: { amountCents: number }[] }
const refundBill = ref<RefundBill | null>(null)
const refundLine = ref<StatementLine | null>(null)
async function openRefund(l: StatementLine, billId: number) {
  const target = bill(billId)
  if (!target) return
  const monthBills = await run(() => $fetch('/api/bills', { query: { month: target.addedOn.slice(0, 7) } }))
  const full = monthBills?.find(b => b.id === billId)
  if (!full) return
  refundLine.value = l
  refundBill.value = full
  refundOpen.value = true
}

async function markPersonal(billId: number, userId: number) {
  if (await run(() => $fetch(`/api/bills/${billId}/card`, { method: 'PUT', body: { userId } }), 'Marked as paid with a different card')) await reload()
}
const personalItems = (billId: number) => users.value.map(u => ({ label: `${u.name.split(' ')[0]}'s personal card`, onSelect: () => markPersonal(billId, u.id) }))

// ---- Card payments ----
const pUsedBills = computed(() => new Set([...pMatches.value.flatMap(m => m.billIds), ...pSuggestions.value.flatMap(s => s.billIds)]))
const pUsedLines = computed(() => new Set([...pMatches.value.map(m => m.lineId), ...pSuggestions.value.map(s => s.lineId)]))
const pLeftoverLines = computed(() => lines.value.filter(l => l.kind === 'payment' && !pUsedLines.value.has(l.id)))
const pLeftoverBills = computed(() => bills.value.filter(b => b.cardPaidAt && !pUsedBills.value.has(b.id)))
// Only card payments recorded inside the statement dates should have a Citi line in this file.
const pOffBy = computed(() => -pLeftoverLines.value.reduce((s, l) => s + l.amountCents, 0)
  - pLeftoverBills.value.filter(b => inRange(b.cardPaidAt!.slice(0, 10))).reduce((s, b) => s + b.cardDueCents, 0))
const checkedSum = (lineId: string) => (pChecks.value[lineId] ?? []).reduce((s, id) => s + (bill(id)?.cardDueCents ?? 0), 0)
function toggleCheck(lineId: string, billId: number) {
  const cur = pChecks.value[lineId] ?? []
  pChecks.value = { ...pChecks.value, [lineId]: cur.includes(billId) ? cur.filter(x => x !== billId) : [...cur, billId] }
}
function matchPayment(lineId: string) {
  pMatches.value = [...pMatches.value, { kind: 'manual', lineId, billIds: pChecks.value[lineId] ?? [] }]
  const { [lineId]: _, ...rest } = pChecks.value
  pChecks.value = rest
}
function confirmPayment(s: { lineId: string, billIds: number[] }) {
  pSuggestions.value = pSuggestions.value.filter(x => x !== s)
  pMatches.value = [...pMatches.value, { kind: 'confirmed', ...s }]
}
function dismissPayment(s: { lineId: string, billIds: number[] }) {
  pDismissed.value = [...pDismissed.value, pSuggestionKey(s)]
  pSuggestions.value = pSuggestions.value.filter(x => x !== s)
}
const unmatchPayment = (m: PaymentMatch) => (pMatches.value = pMatches.value.filter(x => x !== m))

const billNames = (ids: number[]) => ids.map(id => bill(id)?.name ?? `#${id}`).join(' + ')
const linesText = (ids: string[]) => ids.map(id => formatMoney(line(id).amountCents)).join(' + ')
const refundById = (id: number) => refunds.value.find(r => r.id === id)

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const money = (cents: number) => (cents < 0 ? '−' : '') + formatMoney(Math.abs(cents))
</script>

<template>
  <div class="space-y-8">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold text-highlighted">
          Reconcile
        </h1>
        <p class="text-sm text-muted">
          Check a Citi CSV export against the bills.
        </p>
      </div>
      <div v-if="fileName" class="flex items-center gap-3 text-sm">
        <span class="text-toned"><b class="text-highlighted">{{ fileName }}</b> · {{ usDotDate(range.from) }} – {{ usDotDate(range.to) }}</span>
        <UButton color="neutral" variant="soft" class="rounded-full" icon="i-lucide-rotate-ccw" @click="startOver">
          Start Over
        </UButton>
      </div>
    </div>

    <div v-if="!fileName" class="surface-card p-10 text-center">
      <UFileUpload
        accept=".csv,text/csv"
        label="Drop your Citi CSV here"
        icon="i-lucide-file-spreadsheet"
        class="max-w-xl mx-auto min-h-48"
        @update:model-value="(f: unknown) => onFile(f as File | null)"
      />
    </div>

    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div class="surface-card px-5 py-4">
          <div class="text-sm text-toned">
            Matched automatically
          </div>
          <div class="text-xl font-bold text-success tabular-nums">
            {{ autoCount }}
          </div>
        </div>
        <div class="surface-card px-5 py-4">
          <div class="text-sm text-toned">
            Needs you
          </div>
          <div class="text-xl font-bold tabular-nums" :class="needsYou ? 'text-warning' : 'text-success'">
            {{ needsYou }}
          </div>
        </div>
        <div class="surface-card px-5 py-4">
          <div class="text-sm text-toned">
            Statement (charges − refunds)
          </div>
          <div class="text-xl font-bold text-highlighted tabular-nums">
            {{ money(statementTotal) }}
          </div>
        </div>
        <div class="surface-card px-5 py-4">
          <div class="text-sm text-toned">
            App (shared card)
          </div>
          <div class="text-xl font-bold text-highlighted tabular-nums">
            {{ money(appTotal) }}
          </div>
        </div>
        <div class="surface-card px-5 py-4">
          <div class="text-sm text-toned">
            Off by
          </div>
          <div class="text-xl font-bold tabular-nums" :class="offBy === 0 ? 'text-success' : 'text-error'">
            {{ money(offBy) }}
          </div>
        </div>
      </div>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold text-highlighted">
          Charges & Refunds
        </h2>

        <div v-if="suggestions.length" class="space-y-2">
          <div class="text-xs font-bold uppercase tracking-wider text-muted">
            Suggested: confirm or dismiss
          </div>
          <div v-for="s in suggestions" :key="suggestionKey(s)" class="surface-card flex flex-wrap items-center gap-3 px-4 py-3">
            <span class="flex-1 text-sm">
              <b>{{ titleCase(storeKey(line(s.lineIds[0]!).description)) }}</b> {{ linesText(s.lineIds) }}
              <span class="text-muted">({{ s.lineIds.map(id => usDotDate(line(id).date).slice(0, 5)).join(', ') }})</span>
              = bill <b>{{ bill(s.billId)?.name }}</b> {{ formatMoney(bill(s.billId)?.amountCents ?? 0) }}
            </span>
            <UButton size="sm" class="rounded-full" @click="confirmSuggestion(s)">
              Confirm
            </UButton>
            <UButton size="sm" color="neutral" variant="soft" class="rounded-full" @click="dismissSuggestion(s)">
              Not This
            </UButton>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <div class="text-xs font-bold uppercase tracking-wider text-muted">
            Left over: drag lines onto a bill, or click lines then a bill
          </div>
          <UButton size="sm" color="neutral" variant="soft" class="rounded-full" icon="i-lucide-undo-2" :disabled="!history.length" @click="undo">
            Undo
          </UButton>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="surface-card p-4 space-y-2 min-h-40">
            <div class="font-semibold text-highlighted">
              Citi Statement <span class="text-muted font-normal">· {{ leftoverLines.length }} unmatched</span>
            </div>
            <p v-if="!leftoverLines.length" class="text-sm text-muted">
              Every line is accounted for.
            </p>
            <div
              v-for="l in leftoverLines"
              :key="l.id"
              :draggable="l.kind === 'charge'"
              role="button"
              tabindex="0"
              class="rounded-xl border px-3 py-2 transition"
              :class="selected.includes(l.id) ? 'border-primary bg-primary/10 ring-2 ring-primary/30' : 'border-default bg-elevated/30'"
              @click="l.kind === 'charge' && toggleSelect(l.id)"
              @keydown.enter.self.prevent="l.kind === 'charge' && toggleSelect(l.id)"
              @keydown.space.self.prevent="l.kind === 'charge' && toggleSelect(l.id)"
              @dragstart="(e: DragEvent) => { if (!selected.includes(l.id)) selected = [l.id]; e.dataTransfer?.setData('text/plain', l.id) }"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-sm font-medium text-highlighted truncate">
                    {{ l.description }}
                  </div>
                  <div class="text-xs text-muted">
                    {{ usDotDate(l.date) }}
                    <UBadge v-if="l.status.toLowerCase() !== 'cleared'" color="warning" variant="soft" size="sm" class="ms-1">
                      {{ l.status }}
                    </UBadge>
                    <UBadge v-if="l.kind === 'refund'" color="error" variant="soft" size="sm" class="ms-1">
                      Refund
                    </UBadge>
                  </div>
                </div>
                <span class="font-semibold tabular-nums" :class="l.amountCents < 0 && 'text-success'">{{ money(l.amountCents) }}</span>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-2" @click.stop>
                <template v-if="l.kind === 'charge'">
                  <UButton size="xs" color="neutral" variant="soft" class="rounded-full" icon="i-lucide-plus" @click="addAsBill(l)">
                    Add as New Bill
                  </UButton>
                </template>
                <USelect
                  v-else
                  :model-value="undefined"
                  :items="refundTargets"
                  placeholder="Record refund on…"
                  size="xs"
                  class="w-72"
                  @update:model-value="(v: unknown) => openRefund(l, Number(v))"
                />
                <UButton size="xs" color="neutral" variant="ghost" class="rounded-full" @click="ignore(l.id)">
                  Ignore
                </UButton>
              </div>
            </div>
          </div>

          <div class="surface-card p-4 space-y-2 min-h-40">
            <div class="font-semibold text-highlighted">
              Bills With No Match <span class="text-muted font-normal">· {{ leftoverBills.length }}</span>
            </div>
            <p v-if="!leftoverBills.length" class="text-sm text-muted">
              Every bill in this range has a Citi line.
            </p>
            <div
              v-for="b in leftoverBills"
              :key="b.id"
              role="button"
              tabindex="0"
              class="rounded-xl border-2 border-dashed px-3 py-2 transition"
              :class="dragOver === b.id ? 'border-primary bg-primary/10' : 'border-accented'"
              @click="assignTo(b.id)"
              @keydown.enter.self.prevent="assignTo(b.id)"
              @keydown.space.self.prevent="assignTo(b.id)"
              @dragover.prevent="dragOver = b.id"
              @dragleave="dragOver = null"
              @drop.prevent="dragOver = null; assignTo(b.id)"
            >
              <div class="flex justify-between gap-3 font-semibold text-highlighted">
                <span>{{ b.name }} <span class="text-xs font-normal text-muted">{{ usDotDate(b.addedOn) }}</span>
                  <UBadge v-if="!inRange(b.addedOn)" color="neutral" variant="soft" size="sm" class="ms-1">{{ b.addedOn > range.to ? 'After statement' : 'Before statement' }}</UBadge></span>
                <span class="tabular-nums">{{ formatMoney(b.amountCents) }}</span>
              </div>
              <div class="text-xs text-toned tabular-nums mt-0.5">
                <template v-if="assigned[b.id]">
                  {{ formatMoney(sum(assigned[b.id]!)) }} of {{ formatMoney(b.amountCents) }} ·
                  <span :class="sum(assigned[b.id]!) > b.amountCents && 'text-error font-medium'">{{ sum(assigned[b.id]!) > b.amountCents ? `${formatMoney(sum(assigned[b.id]!) - b.amountCents)} over` : `${formatMoney(b.amountCents - sum(assigned[b.id]!))} to go` }}</span>
                </template>
                <template v-else>
                  Drop pieces here
                </template>
              </div>
              <div v-if="assigned[b.id]" class="mt-1.5 flex flex-wrap gap-1.5">
                <span v-for="id in assigned[b.id]" :key="id" class="inline-flex items-center gap-1 rounded-full border border-default bg-default ps-2.5 pe-1 py-0.5 text-xs tabular-nums">
                  {{ titleCase(storeKey(line(id).description)) }} · {{ formatMoney(line(id).amountCents) }}
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" class="rounded-full p-0.5" :aria-label="`Send ${formatMoney(line(id).amountCents)} back`" @click.stop="sendBack(b.id, id)" />
                </span>
              </div>
              <div v-else class="mt-2" @click.stop>
                <UDropdownMenu :items="personalItems(b.id)">
                  <UButton size="xs" color="neutral" variant="soft" class="rounded-full" icon="i-lucide-wallet">
                    Mark Paid With Different Card
                  </UButton>
                </UDropdownMenu>
              </div>
            </div>
          </div>
        </div>

        <details class="surface-card px-4 py-3">
          <summary class="cursor-pointer font-semibold text-highlighted">
            Matched ({{ matches.length + refundMatches.length }}) · click to review
          </summary>
          <ul class="mt-2 divide-y divide-default">
            <li v-for="m in matches" :key="`${m.billId}:${m.lineIds.join()}`" class="flex flex-wrap items-center gap-3 py-2 text-sm">
              <UBadge :color="m.kind === 'auto' ? 'success' : 'primary'" variant="soft" size="sm">
                {{ m.kind === 'auto' ? 'Auto' : m.kind === 'confirmed' ? 'Confirmed' : 'Manual' }}
              </UBadge>
              <span class="flex-1">
                <b>{{ titleCase(storeKey(line(m.lineIds[0]!).description)) }}</b> {{ linesText(m.lineIds) }} ⇄ bill <b>{{ bill(m.billId)?.name }}</b> {{ formatMoney(bill(m.billId)?.amountCents ?? 0) }}
              </span>
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" class="rounded-full" @click="unmatch(m)">
                Unmatch
              </UButton>
            </li>
            <li v-for="m in refundMatches" :key="`r${m.lineId}`" class="flex items-center gap-3 py-2 text-sm">
              <UBadge color="error" variant="soft" size="sm">
                Refund
              </UBadge>
              <span class="flex-1">{{ line(m.lineId).description }} {{ money(line(m.lineId).amountCents) }} ⇄ recorded refund {{ formatMoney(refundById(m.refundId)?.amountCents ?? 0) }}</span>
            </li>
          </ul>
        </details>
      </section>

      <section class="space-y-3">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-lg font-semibold text-highlighted">
            Card Payments
          </h2>
          <span class="text-sm">Payments off by <b class="tabular-nums" :class="pOffBy === 0 ? 'text-success' : 'text-error'">{{ money(pOffBy) }}</b></span>
        </div>

        <div v-for="s in pSuggestions" :key="pSuggestionKey(s)" class="surface-card flex flex-wrap items-center gap-3 px-4 py-3">
          <span class="flex-1 text-sm"><b>Payment {{ usDotDate(line(s.lineId).date).slice(0, 5) }}</b> {{ formatMoney(-line(s.lineId).amountCents) }} = Pay Card on <b>{{ billNames(s.billIds) }}</b></span>
          <UButton size="sm" class="rounded-full" @click="confirmPayment(s)">
            Confirm
          </UButton>
          <UButton size="sm" color="neutral" variant="soft" class="rounded-full" @click="dismissPayment(s)">
            Not This
          </UButton>
        </div>

        <div v-for="p in pLeftoverLines" :key="p.id" class="surface-card px-4 py-3 space-y-2">
          <div class="flex justify-between text-sm">
            <span><b>Payment {{ usDotDate(p.date) }}</b> · tick the bills it paid</span>
            <span class="tabular-nums">{{ formatMoney(checkedSum(p.id)) }} of <b>{{ formatMoney(-p.amountCents) }}</b></span>
          </div>
          <div class="flex flex-wrap gap-2">
            <UCheckbox
              v-for="b in pLeftoverBills"
              :key="b.id"
              :model-value="(pChecks[p.id] ?? []).includes(b.id)"
              :label="`${b.name} · ${formatMoney(b.cardDueCents)} · paid ${usDotDate(b.cardPaidAt!.slice(0, 10)).slice(0, 5)}`"
              class="rounded-full border border-default px-3 py-1"
              @update:model-value="toggleCheck(p.id, b.id)"
            />
            <span v-if="!pLeftoverBills.length" class="text-sm text-muted">No unmatched card payments in the app.</span>
          </div>
          <UButton v-if="checkedSum(p.id) === -p.amountCents" size="sm" class="rounded-full" @click="matchPayment(p.id)">
            Match
          </UButton>
        </div>

        <div v-if="pLeftoverBills.length && !pLeftoverLines.length" class="surface-card px-4 py-3 text-sm">
          <b>Card paid in the app, no Citi payment found:</b> {{ pLeftoverBills.map(b => `${b.name} ${formatMoney(b.cardDueCents)}`).join(' · ') }}
        </div>

        <details class="surface-card px-4 py-3">
          <summary class="cursor-pointer font-semibold text-highlighted">
            Matched payments ({{ pMatches.length }})
          </summary>
          <ul class="mt-2 divide-y divide-default">
            <li v-for="m in pMatches" :key="`${m.lineId}`" class="flex items-center gap-3 py-2 text-sm">
              <UBadge :color="m.kind === 'auto' ? 'success' : 'primary'" variant="soft" size="sm">
                {{ m.kind === 'auto' ? 'Auto' : m.kind === 'confirmed' ? 'Confirmed' : 'Manual' }}
              </UBadge>
              <span class="flex-1">Payment {{ usDotDate(line(m.lineId).date) }} {{ formatMoney(-line(m.lineId).amountCents) }} ⇄ {{ billNames(m.billIds) }}</span>
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" class="rounded-full" @click="unmatchPayment(m)">
                Unmatch
              </UButton>
            </li>
          </ul>
        </details>
      </section>
    </template>

    <RefundModal
      v-model:open="refundOpen"
      :bill="refundBill"
      :users="users"
      :initial-amount-cents="refundLine ? -refundLine.amountCents : undefined"
      :initial-date="refundLine?.date"
      @changed="reload"
    />
  </div>
</template>
