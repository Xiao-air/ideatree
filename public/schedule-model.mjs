export const SCHEDULE_COLORS = ['#277d72', '#5b73ae', '#ac7b3f', '#9373a5', '#508293'];
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function addDays(date, amount) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate()+amount); return localDate(value); }
export function weekStart(date) { const value = new Date(`${date}T12:00:00`); return addDays(date, -((value.getDay()+6)%7)); }
export const timeLabel = minutes => `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
export const timeMinutes = value => Number(value.slice(0,2))*60+Number(value.slice(3));
export function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value; }
export function validateSchedule(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.entries) || input.entries.length > 10000) throw new Error('这不是有效的实验安排备份。');
  const ids = new Set();
  const entries = input.entries.map(entry => {
    if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 100 || ids.has(entry.id)) throw new Error('实验安排编号无效或重复。');
    ids.add(entry.id);
    if (typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 100) throw new Error('请填写实验名称，最多 100 字。');
    if (typeof entry.note !== 'string' || entry.note.length > 4000) throw new Error('实验内容最多 4000 字。');
    if (Object.hasOwn(entry,'week')) {
      if (!validDate(entry.week) || weekStart(entry.week) !== entry.week) throw new Error('请选择有效的所属周，备份中的周日期须为周一。');
      if (entry.date != null || entry.start != null || entry.end != null) throw new Error('待安排工作不能同时填写具体日期和时段。');
      return { id: entry.id, title: entry.title.trim(), week: entry.week, note: entry.note.trim(), color: SCHEDULE_COLORS.includes(entry.color) ? entry.color : SCHEDULE_COLORS[0] };
    }
    if (!validDate(entry.date)) throw new Error('请选择有效的实验日期。');
    if (!Number.isInteger(entry.start) || !Number.isInteger(entry.end) || entry.start < 0 || entry.end > 1440 || entry.end <= entry.start || entry.start%5 || entry.end%5) throw new Error('结束时间应晚于开始时间，请使用 5 分钟刻度。');
    return { id: entry.id, title: entry.title.trim(), date: entry.date, start: entry.start, end: entry.end, note: entry.note.trim(), color: SCHEDULE_COLORS.includes(entry.color) ? entry.color : SCHEDULE_COLORS[0] };
  });
  return { version: 1, entries };
}
export function packDay(entries) {
  const sorted = [...entries].sort((a,b) => a.start-b.start || a.end-b.end || a.id.localeCompare(b.id));
  const placed = []; let group = [], groupEnd = -1;
  const finish = () => { const columns = Math.max(1,...group.map(item => item.column+1)); group.forEach(item => { item.columns = columns; }); placed.push(...group); group = []; };
  for (const entry of sorted) {
    if (entry.start >= groupEnd && group.length) finish();
    const occupied = new Set(group.filter(item => item.entry.end > entry.start).map(item => item.column));
    let column = 0; while (occupied.has(column)) column++;
    group.push({ entry, column }); groupEnd = Math.max(groupEnd, entry.end);
  }
  if (group.length) finish();
  return placed;
}
