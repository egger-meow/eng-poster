import { DateTime } from 'luxon';
export function chooseSlot(date: string, window: string, zone: string, occupied: Set<string>): string {
  const [start,end] = window.split('-'); if (!start || !end) throw new Error(`Invalid window ${window}`);
  const s=DateTime.fromISO(`${date}T${start}`,{zone}); const e=DateTime.fromISO(`${date}T${end}`,{zone});
  const minutes=Math.max(0,Math.floor(e.diff(s,'minutes').minutes)); let offset=Math.floor(minutes/2);
  let candidate=s.plus({minutes:offset}).startOf('minute'); while(occupied.has(candidate.toISO()!)){ offset=(offset+7)%(minutes+1); candidate=s.plus({minutes:offset}).startOf('minute'); }
  occupied.add(candidate.toISO()!); return candidate.toUTC().toISO()!;
}
