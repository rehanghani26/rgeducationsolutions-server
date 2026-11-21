export function sessionDay(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

export function validSessionDay(value) {
  const day = sessionDay(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(day);
  return Number.isFinite(date.getTime()) && sessionDay(date) === day;
}

export function addSessionDays(day, count) {
  const date = new Date(day);
  date.setUTCDate(date.getUTCDate() + count);
  return sessionDay(date);
}

export function defaultSessionEnd(day) {
  const date = new Date(day);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return addSessionDays(sessionDay(date), -1);
}

export function shiftedSessionEnd(session, startDate) {
  const days = (new Date(sessionDay(session.endDate)) - new Date(sessionDay(session.startDate))) / 86_400_000;
  return addSessionDays(startDate, days);
}

export function schoolClock(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { day: values.year + '-' + values.month + '-' + values.day, time: values.hour + ':' + values.minute };
}
