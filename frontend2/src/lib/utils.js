import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function parseEventHour(timestamp) {
  const d = new Date(timestamp)
  return { hour: d.getHours(), min: d.getMinutes() }
}

export function formatDate(date, opts = {}) {
  const locale = typeof navigator !== 'undefined' && navigator.language.startsWith('it') ? 'it-IT' : 'en-US'
  return new Intl.DateTimeFormat(locale, opts).format(date)
}

export function formatTime(date, opts = { hour: '2-digit', minute: '2-digit', second: '2-digit' }) {
  const locale = typeof navigator !== 'undefined' && navigator.language.startsWith('it') ? 'it-IT' : 'en-US'
  return new Intl.DateTimeFormat(locale, opts).format(date)
}

export function initials(name) {
  if (!name) return '?'
  return name.split(/[\s._-]+/).map((n) => n[0]).join('').slice(0, 2).toUpperCase()
}

export function relTime(date) {
  const locale = typeof navigator !== 'undefined' && navigator.language.startsWith('it') ? 'it' : 'en'
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    Math.round((date - Date.now()) / 1000),
    'second'
  )
}
