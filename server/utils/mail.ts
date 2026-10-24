import nodemailer, { type Transporter } from 'nodemailer'

export interface MailMessage {
  to: string
  subject: string
  lines: string[]
  action?: { label: string, url: string }
}

/** Filled when MAIL_TRANSPORT=memory (tests). */
export const sentMail: MailMessage[] = []

let transporter: Transporter | undefined

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!))

export function appUrl(path = '/'): string {
  return new URL(path, process.env.APP_URL ?? 'http://localhost:3000').toString()
}

export async function sendMail(message: MailMessage): Promise<void> {
  const mode = process.env.MAIL_TRANSPORT
  if (mode === 'memory') {
    sentMail.push(message)
    return
  }
  const text = [...message.lines, ...(message.action ? ['', `${message.action.label}: ${message.action.url}`] : [])].join('\n')
  if (mode === 'log' || !process.env.MAIL_URL) {
    console.info(`[mail] to=${message.to} subject="${message.subject}"\n${text}`)
    return
  }
  transporter ??= nodemailer.createTransport(process.env.MAIL_URL)
  const html = `<div style="font-family:Figtree,Arial,sans-serif;font-size:15px;color:#1f2937">
${message.lines.map(l => `<p>${escapeHtml(l)}</p>`).join('\n')}
${message.action ? `<p><a href="${escapeHtml(message.action.url)}" style="display:inline-block;padding:10px 18px;background:#0284c7;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(message.action.label)}</a></p>` : ''}
</div>`
  await transporter.sendMail({ from: process.env.MAIL_FROM ?? 'Ledford Bills <bills@localhost>', to: message.to, subject: message.subject, text, html })
}

/** Mail must never break the request that triggered it. */
export function queueMail(message: MailMessage): void {
  sendMail(message).catch(error => console.error('[mail] failed', message.subject, error))
}
