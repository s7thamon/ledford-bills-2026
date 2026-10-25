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

const DETAIL = /^([^:]{1,30}):\s+(.+)$/

/** Table-based layout with inline styles, since mail clients ignore <style> and modern CSS. */
export function renderMailHtml(message: MailMessage): string {
  const details = message.lines.map(l => l.match(DETAIL)).filter(m => m !== null)
  const paragraphs = message.lines.filter(l => !DETAIL.test(l))
  const font = 'Poppins,-apple-system,Segoe UI,Helvetica,Arial,sans-serif'
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f7;padding:32px 12px;font-family:${font}">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 16px;font-size:16px;font-weight:700;color:#0f1a1e">
<span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;border-radius:8px;background:#0ea5e9;color:#ffffff;font-size:15px;margin-right:8px">$</span>Ledford Bills
</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e3e8ea;border-radius:16px;padding:28px">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:700;color:#0f1a1e">${escapeHtml(message.subject)}</h1>
${paragraphs.map(l => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3b4a50">${escapeHtml(l)}</p>`).join('\n')}
${details.length
  ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:#f7fafb;border:1px solid #e3e8ea;border-radius:12px">
${details.map(([, label, value], i) => `<tr>
<td style="padding:10px 16px;font-size:13px;color:#5c6b70;${i ? 'border-top:1px solid #e9eef0;' : ''}">${escapeHtml(label!)}</td>
<td style="padding:10px 16px;font-size:15px;font-weight:600;color:#0f1a1e;text-align:right;${i ? 'border-top:1px solid #e9eef0;' : ''}">${escapeHtml(value!)}</td>
</tr>`).join('\n')}
</table>`
  : ''}
${message.action
  ? `<a href="${escapeHtml(message.action.url)}" style="display:inline-block;padding:11px 22px;background:#0ea5e9;color:#ffffff;border-radius:999px;font-size:14px;font-weight:600;text-decoration:none">${escapeHtml(message.action.label)}</a>`
  : ''}
</td></tr>
<tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.5;color:#8a979c">You get this email because you share bills in Ledford Bills.</td></tr>
</table>
</td></tr>
</table>
</body></html>`
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
  const html = renderMailHtml(message)
  await transporter.sendMail({ from: process.env.MAIL_FROM ?? 'Ledford Bills <bills@localhost>', to: message.to, subject: message.subject, text, html })
}

/** Mail must never break the request that triggered it. */
export function queueMail(message: MailMessage): void {
  sendMail(message).catch(error => console.error('[mail] failed', message.subject, error))
}
