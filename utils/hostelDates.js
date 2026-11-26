import { academicError } from './academicScope.js';

const schoolDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });

export function hostelEventDate(value, label, now = new Date()) {
  if (value === undefined) return now;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw academicError(`Enter a valid ${label}.`);
  const date = new Date(`${value}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime()) || schoolDay.format(date) !== value) throw academicError(`Enter a valid ${label}.`);
  const today = schoolDay.format(now);
  if (value > today) throw academicError(`The ${label} cannot be in the future.`);
  return value === today ? now : date;
}

export function onOrAfterHostelDay(date, earliest, message) {
  if (!earliest || date >= earliest) return date;
  if (schoolDay.format(date) === schoolDay.format(earliest)) return earliest;
  throw academicError(message, 409);
}
