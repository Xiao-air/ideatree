export const STATES = {
  pending: { label: '待评估', color: '#778194' },
  active: { label: '推进中', color: '#22776c' },
  paused: { label: '暂停', color: '#9b6d21' },
  stopped: { label: '中止', color: '#b35862' },
  completed: { label: '已完成', color: '#5b6ab0' },
};
export const KINDS = ['文献调研', '导师讨论', '计算 / 实验', '灵感记录', '状态变更', '衍生'];
export const PALETTE = ['#277d72', '#5b73ae', '#ac7b3f', '#9373a5', '#508293', '#ad6871'];
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const dateValue = value => new Date(`${value}T12:00:00`);
export const id = () => crypto.randomUUID();
export const orderedEvents = idea => [...idea.events].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
export function statusAt(idea, date = '9999-12-31') {
  return orderedEvents(idea).filter(e => e.date <= date && e.status).reduce((s, e) => e.status, idea.initialStatus);
}
export function descendants(ideas, root) {
  const found = new Set([root]);
  for (let changed = true; changed;) {
    changed = false;
    for (const idea of ideas) if (found.has(idea.parentId) && !found.has(idea.id)) { found.add(idea.id); changed = true; }
  }
  return found;
}
export function treeRows(ideas, collapsed = new Set()) {
  const rows = [];
  function visit(parentId, depth) {
    for (const idea of ideas.filter(i => i.parentId === parentId).sort((a, b) => a.created.localeCompare(b.created))) {
      rows.push({ idea, depth });
      if (!collapsed.has(idea.id)) visit(idea.id, depth + 1);
    }
  }
  visit(null, 0);
  return rows;
}
export function validateDocument(input) {
  const fail = message => { throw new Error(message); };
  if (!input || input.version !== 1 || !Array.isArray(input.ideas)) fail('这不是有效的 IdeaTree 备份（需要 version: 1 和 ideas）。');
  if (input.ideas.length > 1000) fail('单个空间最多支持 1000 个 idea。');
  const string = (v, name, max, required = false) => {
    if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(`${name}格式不正确。`);
    return v.trim();
  };
  const date = (v, name) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(`${v}T12:00:00Z`)) || new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) !== v || v > today()) fail(`${name}必须是有效日期，且不能晚于今天。`);
    return v;
  };
  const state = v => { if (!Object.hasOwn(STATES, v)) fail('存在未知状态。'); return v; };
  const ids = new Set(); const eventIds = new Set(); let count = 0;
  const ideas = input.ideas.map(i => {
    if (!i || typeof i !== 'object') fail('Idea 数据格式不正确。');
    const ideaId = string(i.id, '编号', 100, true);
    if (ids.has(ideaId)) fail('Idea 编号重复。'); ids.add(ideaId);
    const created = date(i.created, '首次提出时间');
    if (!Array.isArray(i.events)) fail('缺少事件列表。');
    count += i.events.length; if (count > 20000) fail('事件数量超过 20000。');
    return {
      id: ideaId, name: string(i.name, '简称', 60, true), summary: string(i.summary ?? '', '核心问题', 4000),
      created, initialStatus: state(i.initialStatus), color: PALETTE.includes(i.color) ? i.color : PALETTE[0],
      parentId: i.parentId == null ? null : string(i.parentId, '来源编号', 100, true),
      parentEventId: i.parentEventId == null ? null : string(i.parentEventId, '来源事件', 100, true),
      events: i.events.map((e, index) => {
        if (!e || typeof e !== 'object') fail('事件格式不正确。');
        const eventId = string(e.id, '事件编号', 100, true);
        if (eventIds.has(eventId)) fail('事件编号重复。'); eventIds.add(eventId);
        const eventDate = date(e.date, '事件时间'); if (eventDate < created) fail('事件不能早于 idea 首次提出的时间。');
        if (!KINDS.includes(e.kind)) fail('存在未知事件类型。');
        const link = string(e.link ?? '', '参考链接', 2000);
        if (link && !/^https?:\/\//i.test(link)) fail('参考链接必须以 http:// 或 https:// 开头。');
        return { id: eventId, date: eventDate, kind: e.kind, title: string(e.title, '事件标题', 120, true),
          note: string(e.note ?? '', '记录内容', 10000), next: string(e.next ?? '', '下一步', 2000), link,
          status: e.status ? state(e.status) : null, order: Number.isFinite(e.order) ? e.order : index };
      }),
    };
  });
  const map = new Map(ideas.map(i => [i.id, i]));
  for (const idea of ideas) {
    if (idea.parentId) {
      const parent = map.get(idea.parentId);
      if (!parent || parent.id === idea.id) fail('来源 idea 不存在或指向自身。');
      const event = parent.events.find(e => e.id === idea.parentEventId);
      if (!event || event.date !== idea.created) fail('衍生时间必须对应来源事件的日期。');
      const seen = new Set([idea.id]); let p = parent;
      while (p) { if (seen.has(p.id)) fail('衍生关系不能构成循环。'); seen.add(p.id); p = map.get(p.parentId); }
    } else if (idea.parentEventId) fail('独立 idea 不应设置来源事件。');
  }
  return { version: 1, name: string(input.name ?? '我的研究', '空间名称', 60, true), demo: input.demo === true, ideas };
}
export function makeDemo() {
  const ago = n => { const d = dateValue(today()); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const ev = (id, n, kind, title, note, status = null, next = '') => ({ id, date: ago(n), kind, title, note, status, next, link: '', order: 100 - n });
  return { version: 1, name: '研究灵感', demo: true, ideas: [
    { id: 'reading', name: '多模态文献阅读', summary: '让图、表与正文一起参与文献理解，减少在不同信息之间来回切换。', created: ago(85), initialStatus: 'active', color: PALETTE[0], parentId: null, parentEventId: null, events: [
      ev('r1', 72, '文献调研', '梳理现有阅读工具', '现有工具擅长段落摘要，但图表与结论之间的联系仍需人工整理。'),
      ev('r2', 55, '导师讨论', '聚焦证据与结论', '先把问题缩小到一篇论文内的证据关联，衍生出“文献证据卡”。', null, '用 5 篇论文验证记录方式。'),
      ev('r3', 30, '灵感记录', '从单篇走向跨论文', '同一论点在不同论文中存在不同条件。可独立研究论点与适用边界的索引。'),
      ev('r4', 9, '计算 / 实验', '完成阅读流程验证', '图表定位对理解研究结论有帮助，下一步观察连续阅读时的使用体验。', 'active', '收集连续一周的使用记录。'),
    ] },
    { id: 'evidence', name: '文献证据卡', summary: '将每个研究结论与支持它的图表、实验条件和证据边界连接起来。', created: ago(55), initialStatus: 'active', color: PALETTE[1], parentId: 'reading', parentEventId: 'r2', events: [
      ev('e1', 43, '文献调研', '设计卡片字段', '保留问题、结论、证据位置和适用条件；避免逐段抄写论文。'),
      ev('e2', 25, '计算 / 实验', '试读 5 篇论文', '卡片便于回溯结论，但需要降低记录成本。', null, '将必填项缩减到核心四项。'),
      ev('e3', 5, '导师讨论', '继续验证可复用性', '卡片值得继续发展，重点检查跨论文比较时能否复用。', 'active', '补充两篇结论不同的论文，比较条件差异。'),
    ] },
    { id: 'claims', name: '跨论文论点索引', summary: '以问题和论点组织多篇论文，保留不同研究条件下的结论差异。', created: ago(30), initialStatus: 'active', color: PALETTE[3], parentId: 'reading', parentEventId: 'r3', events: [
      ev('c1', 13, '状态变更', '等待证据卡稳定', '当前输入数据结构尚未稳定，先暂停，避免重复改动。', 'paused', '证据卡完成 20 篇试读后重新评估。'),
    ] },
    { id: 'notes', name: '实验记录自动整理', summary: '从零散实验笔记中自动生成结构化实验日志。', created: ago(69), initialStatus: 'active', color: PALETTE[2], parentId: null, parentEventId: null, events: [
      ev('n1', 51, '文献调研', '比较记录方式', '不同实验类型的字段差异较大，统一模板需要反复人工修正。'),
      ev('n2', 18, '状态变更', '中止通用整理方案', '通用方案投入较大，现阶段收益不明确。保留失败原因归纳这个更具体的问题。', 'stopped'),
    ] },
    { id: 'failures', name: '失败实验知识库', summary: '记录失败现象、排查过程与恢复条件，让负面结果可被复用。', created: ago(18), initialStatus: 'pending', color: PALETTE[4], parentId: 'notes', parentEventId: 'n2', events: [] },
    { id: 'weekly', name: '每周研究回顾', summary: '用关键决策而非任务数量记录一周的研究进展。', created: ago(44), initialStatus: 'active', color: PALETTE[5], parentId: null, parentEventId: null, events: [
      ev('w1', 28, '计算 / 实验', '尝试连续记录', '一周只记录改变判断的事件，减少整理负担。'),
      ev('w2', 7, '状态变更', '完成四周验证', '形成可持续使用的回顾模板，已达到这次验证的目标。', 'completed'),
    ] },
  ] };
}
