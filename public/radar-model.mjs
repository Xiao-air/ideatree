export function validateRadarCatalog(input) {
  const fail = message => { throw new Error(message); };
  const text = (value, label, max = 12000) => {
    if (typeof value !== 'string' || value.length > max) fail(`${label}格式不正确。`);
    return value;
  };
  const list = (value, label, max) => {
    if (!Array.isArray(value) || value.length > max) fail(`${label}格式不正确或数量过多。`);
    return value;
  };
  const strings = (value, label) => list(value, label, 80).map(v => text(v, label, 1000));
  const fields = (value, names, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}缺失。`);
    return Object.fromEntries(names.map(name => [name, text(value[name], `${label}.${name}`)]));
  };
  const source = value => {
    const clean = fields(value, ['path','locator','kind','version','recordedDate','agent'], '来源');
    if (!/\.(md|json|jsonl|csv|txt)$/i.test(clean.path) || clean.path.startsWith('/') || clean.path.includes('\\') || clean.path.includes(':') || clean.path.split('/').some(p => !p || p === '.' || p === '..')) fail('来源必须是项目内的相对文本文件路径。');
    return clean;
  };
  const unique = (items, label) => {
    const ids = new Set();
    for (const item of items) {
      if (!item.id.trim() || ids.has(item.id)) fail(`${label}编号为空或重复。`);
      ids.add(item.id);
    }
    return ids;
  };
  if (!input || input.version !== 1 || !input.catalogId) fail('请选择Radar备选库JSON文件；主时间树备份不能在这里导入。');
  const clean = fields(input, ['catalogId','name','snapshotAt','overview'], '备选库');
  const categories = list(input.categories, '分类', 50).map(c => fields(c, ['id','name','description','boundary'], '分类'));
  const categoryIds = unique(categories, '分类');
  const families = list(input.families, '家族', 1000).map(f => fields(f, ['id','categoryId','lineageKey','name','coreQuestion','reviewNote'], '家族'));
  const familyIds = unique(families, '家族');
  if (families.some(f => !categoryIds.has(f.categoryId))) fail('家族引用了不存在的分类。');
  const propositions = list(input.propositions, '命题', 2000).map(p => {
    const value = fields(p, ['id','familyId','name','question','plainOverview'], '命题');
    if (!value.question.trim() || !value.plainOverview.trim()) fail('每个命题都需要科学问题和通俗概述。');
    if (!familyIds.has(value.familyId)) fail('命题引用了不存在的家族。');
    const tags = Object.fromEntries(['scientificProblemType','acousticRole','keywords'].map(key => [key, strings(p.tags?.[key], '标签')]));
    const progress = fields(p.progress, ['stage','sourceRecommendation','assessment','evidenceCorrection','userDecision','mentorDiscussion','discussionMaterials','mentorReady','lastProcessed','owner','reviewNote'], '已有状态');
    if (['weak','reject','rejected','reject_local','LATE_KILL'].includes(progress.stage)) fail('明确淘汰条目不能作为保留命题导入。');
    const evidence = fields(p.evidence, ['primaryRead','abstractOnly','gaps','scope'], '证据覆盖');
    const sources = list(p.sources, '命题来源', 150).map(source);
    if (!sources.length) fail('命题必须保留可追溯来源。');
    return { ...value, tags, progress, evidence, indirectHistoryOnly: p.indirectHistoryOnly === true, sources };
  });
  const propositionIds = unique(propositions, '命题');
  if (families.some(f => !propositions.some(p => p.familyId === f.id))) fail('家族不能缺少下属命题。');
  const pending = list(input.pending, '待核对记录', 500).map(p => ({ ...fields(p, ['id','status','reason'], '待核对记录'), source: source(p.source) }));
  unique(pending, '待核对记录');
  if (pending.some(p => propositionIds.has(p.id))) fail('待核对记录不能同时计入主库。');
  const relations = list(input.relations, '关联', 5000).map(r => fields(r, ['from','to','type','note'], '关联'));
  if (relations.some(r => !propositionIds.has(r.from) || !propositionIds.has(r.to))) fail('关联引用了不存在的命题。');
  const metadata = fields(input.metadata, ['sourceSnapshotSha256','classificationDecision','scientificStatusPolicy','phase1Status'], '来源信息');
  metadata.excludedScopeCount = input.metadata.excludedScopeCount;
  if (!Number.isSafeInteger(metadata.excludedScopeCount) || metadata.excludedScopeCount < 0) fail('排除台账数量格式不正确。');
  metadata.reports = list(input.metadata.reports, '报告入口', 10).map(source);
  return { version: 1, ...clean, categories, families, propositions, pending, relations, metadata };
}

export function radarCounts(catalog) {
  return { categories: catalog.categories.length, families: catalog.families.length, propositions: catalog.propositions.length, pending: catalog.pending.length, indirect: catalog.propositions.filter(p => p.indirectHistoryOnly).length };
}

export function filterRadar(catalog, filters = {}) {
  const families = new Map(catalog.families.map(f => [f.id, f]));
  const query = (filters.query || '').trim().toLocaleLowerCase();
  return catalog.propositions.filter(p => {
    if (filters.category && families.get(p.familyId).categoryId !== filters.category) return false;
    if (filters.stage && p.progress.stage !== filters.stage) return false;
    if (filters.problem && !p.tags.scientificProblemType.includes(filters.problem)) return false;
    if (filters.keyword && !p.tags.keywords.includes(filters.keyword)) return false;
    if (filters.acoustic) {
      const roles = p.tags.acousticRole.join(' ').toLowerCase();
      if (filters.acoustic === 'unknown' ? !/(未知|未说明)/.test(roles) : !roles.includes(filters.acoustic)) return false;
    }
    return !query || [p.id,p.name,p.question,p.plainOverview,...Object.values(p.tags).flat(),families.get(p.familyId).name,p.indirectHistoryOnly?'历史引述 原件缺失':''].join(' ').toLocaleLowerCase().includes(query);
  });
}
