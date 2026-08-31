const sensitive = /(authorization|access[_-]?token|api[_-]?key|app[_-]?secret|service[_-]?role|password|signature)/i;
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, sensitive.test(k) ? '[REDACTED]' : redact(v)]));
  if (typeof value === 'string') return value.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi,'Bearer [REDACTED]');
  return value;
}
