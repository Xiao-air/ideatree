import { validateRadarCatalog, radarCounts, filterRadar } from './radar-model.mjs';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
const prose = value => escape(String(value).replace(/\*\*/g, ''));
const chip = (text, kind = '') => `<span class="radar-chip ${kind}">${escape(text)}</span>`;
const sourceUrl = path => `/api/radar/source?path=${encodeURIComponent(path)}`;
const sourceLink = (source, label = source.path.split('/').at(-1)) => `<a href="${sourceUrl(source.path)}" target="_blank" rel="noopener">${escape(label)}</a>`;
let catalog = null, revision = 0, selected = null, mode = 'main', incoming = null, expanded = false;
let filters = { category:'', query:'', stage:'', problem:'', acoustic:'', keyword:'' };
const openFamilies = new Set();
const fieldIds = { query:'#radar-search', stage:'#radar-stage', problem:'#radar-problem', acoustic:'#radar-acoustic', keyword:'#radar-keyword' };

function message(text, error = false) {
  $('#radar-message').textContent = text; $('#radar-message').classList.toggle('error', error); $('#radar-message').hidden = !text;
}
function options(selector, values, first) {
  $(selector).innerHTML = `<option value="">${first}</option>` + [...new Set(values)].sort((a,b) => a.localeCompare(b,'zh-CN')).map(v => `<option value="${escape(v)}">${escape(v)}</option>`).join('');
}
function familyFor(prop) { return catalog.families.find(f => f.id === prop.familyId); }
function categoryFor(prop) { return catalog.categories.find(c => c.id === familyFor(prop).categoryId); }
function fillFilters() {
  options('#radar-stage', catalog.propositions.map(p => p.progress.stage), '全部阶段');
  options('#radar-problem', catalog.propositions.flatMap(p => p.tags.scientificProblemType), '全部类型');
  options('#radar-keyword', catalog.propositions.flatMap(p => p.tags.keywords), '全部关键词');
  for (const [key, selector] of Object.entries(fieldIds)) $(selector).value = filters[key];
}
function renderNavigation() {
  if (!catalog) return;
  const counts = radarCounts(catalog);
  const rows = [{id:'',name:'全部方向',families:counts.families,propositions:counts.propositions}, ...catalog.categories.map(c => {
    const fs = catalog.families.filter(f => f.categoryId === c.id);
    return {id:c.id,name:c.name,families:fs.length,propositions:catalog.propositions.filter(p => fs.some(f => f.id === p.familyId)).length};
  })];
  $('#radar-categories').innerHTML = rows.map(c => `<button class="radar-category" data-category="${escape(c.id)}" aria-pressed="${mode === 'main' && filters.category === c.id}">${escape(c.name)}<span>${c.families} / ${c.propositions}</span></button>`).join('');
  $('#radar-pending').setAttribute('aria-pressed', String(mode === 'pending'));
  $('#pending-count').textContent = counts.pending;
  const at = new Date(catalog.snapshotAt);
  const date = Number.isFinite(+at) ? at.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : catalog.snapshotAt;
  $('#radar-totals').textContent = `${counts.categories}个方向 · ${counts.families}个家族 · ${counts.propositions}个命题　｜　${date}盘点快照`;
  $('#radar-export').disabled = false;
}
function records(rows) {
  return `<dl class="radar-records">${rows.map(([label,value]) => `<div><dt>${escape(label)}</dt><dd>${prose(value)}</dd></div>`).join('')}</dl>`;
}
function sourceList(sources) {
  const labels = {origin:'原始问题记录',source_version:'已有版本',assessment:'后续评审',human_decision:'用户决定记录',indirect_history:'间接历史引述',intake_record:'初始准入记录',handoff:'交接对象'};
  return `<ol class="radar-source-list">${sources.map(s => `<li>${sourceLink(s)}<p>${escape(labels[s.kind] || s.kind)} · ${escape(s.agent || '来源维护者未单列')} · ${escape(s.recordedDate)}${s.version ? ' · '+escape(s.version) : ''}</p><p>${escape(s.locator || '参见文件正文')}</p><p><code>${escape(s.path)}</code></p></li>`).join('')}</ol>`;
}
function detail(prop, openMobile = false) {
  const family = familyFor(prop), category = categoryFor(prop), p = prop.progress, e = prop.evidence;
  const mentorReady = ({True:'已有正式就绪记录',False:'尚无正式就绪记录'})[p.mentorReady] || p.mentorReady;
  const related = catalog.relations.filter(r => r.from === prop.id || r.to === prop.id);
  $('#radar-detail').innerHTML = `<div class="radar-detail-heading"><div><div class="radar-breadcrumb">${escape(category.name)} · ${escape(family.id)}</div><h2>${escape(prop.name)}</h2><div class="radar-id">${escape(prop.id)}</div></div><button class="icon-btn radar-detail-close" data-close-detail aria-label="关闭命题详情">×</button></div>
    <div class="radar-detail-tags">${chip(p.stage)}${prop.indirectHistoryOnly ? chip('历史引述 · 原件缺失','history') : ''}${prop.tags.keywords.map(k => chip(k,'neutral')).join('')}</div>
    <section class="radar-detail-section"><h3>通俗概述</h3><p>${prose(prop.plainOverview)}</p></section>
    <section class="radar-detail-section"><h3>科学问题</h3><p>${prose(prop.question)}</p><p class="radar-note">${prose(family.reviewNote)}</p></section>
    <section class="radar-detail-section"><h3>证据与适用边界</h3>${prop.indirectHistoryOnly ? '<p class="radar-note">此命题由历史引述恢复，原始问题卡尚未定位。引述不是独立科学证据。</p>' : ''}${records([['原始来源阅读记录',e.primaryRead],['摘要／二手覆盖',e.abstractOnly],['已记录缺口',e.gaps],['已有阅读范围',e.scope],['证据修正',p.evidenceCorrection]])}<p class="radar-note">阅读记录不等于科学结论已验证；未知不表示没有文献。</p></section>
    <section class="radar-detail-section"><h3>已有状态与决定</h3>${records([['阶段',p.stage],['用户决定',p.userDecision],['讨论材料',p.discussionMaterials],['正式导师就绪记录',mentorReady],['实际导师讨论',p.mentorDiscussion],['最后实质处理记录',p.lastProcessed],['记录维护／研究负责人',p.owner]])}<details class="radar-raw-review"><summary>原始推荐与后续评审</summary>${records([['来源原始推荐',p.sourceRecommendation],['后续评审原文',p.assessment],['待核对事项',p.reviewNote]])}</details></section>
    <section class="radar-detail-section"><h3>三组标签</h3>${records([['科学问题类型',prop.tags.scientificProblemType.join('；')],['声学作用方式',prop.tags.acousticRole.join('；')],['关键词',prop.tags.keywords.join('、')]])}<p class="radar-note">作用方式表示已提出的用途，不表示声学作用或必要性已证明。</p></section>
    <section class="radar-detail-section"><h3>来源与版本 · ${prop.sources.length}条关联</h3>${sourceList(prop.sources)}</section>
    ${related.length ? `<section class="radar-detail-section"><h3>关联命题</h3>${related.map(r => { const id = r.from === prop.id ? r.to : r.from; const other = catalog.propositions.find(p => p.id === id); return `<button class="radar-related" data-related="${escape(id)}">${escape(other.name)}<small>${escape(id)} · ${escape(r.note)}</small></button>`; }).join('')}</section>` : ''}`;
  $('#radar-detail').scrollTop = 0;
  if (openMobile) { $('#radar-detail').classList.add('open'); if (innerWidth <= 900) $('#radar-detail').focus({preventScroll:true}); }
}
function pendingDetail(item, openMobile = false) {
  $('#radar-detail').innerHTML = `<div class="radar-detail-heading"><div><div class="radar-breadcrumb">待核对 · 未计入主库</div><h2>${escape(item.id)}</h2></div><button class="icon-btn radar-detail-close" data-close-detail aria-label="关闭命题详情">×</button></div><section class="radar-detail-section"><h3>收录边界</h3>${records([['已有状态',item.status],['未确认原因',item.reason]])}</section><section class="radar-detail-section"><h3>定位来源</h3>${sourceList([item.source])}</section>`;
  $('#radar-detail').scrollTop = 0;
  if (openMobile) { $('#radar-detail').classList.add('open'); if (innerWidth <= 900) $('#radar-detail').focus({preventScroll:true}); }
}
function renderResults() {
  if (!catalog) return;
  $('#radar-filters').hidden = mode === 'pending';
  $('#radar-expand').hidden = mode === 'pending';
  if (mode === 'pending') {
    $('#radar-direction').textContent = '收录待核对'; $('#radar-result-count').textContent = `${catalog.pending.length}项 · 不计入家族与命题总数`;
    if (!catalog.pending.some(p => p.id === selected)) selected = catalog.pending[0]?.id;
    $('#radar-family-list').innerHTML = catalog.pending.map(p => `<button class="radar-proposition" data-pending="${escape(p.id)}" aria-pressed="${selected===p.id}"><span class="radar-prop-name">${escape(p.id)}</span><span class="radar-prop-question">${escape(p.reason)}</span>${chip('收录待核对','history')}</button>`).join('') || '<p class="radar-empty">没有收录冲突项。</p>';
    if (selected) pendingDetail(catalog.pending.find(p => p.id === selected));
    return;
  }
  const matches = filterRadar(catalog, filters);
  const familyIds = new Set(matches.map(p => p.familyId));
  const families = catalog.families.filter(f => familyIds.has(f.id));
  if (!matches.some(p => p.id === selected)) selected = matches.find(p => p.familyId === families[0]?.id)?.id || null;
  const title = catalog.categories.find(c => c.id === filters.category)?.name || '全部方向';
  $('#radar-direction').textContent = title; $('#radar-result-count').textContent = `${families.length}个家族 / ${matches.length}个命题`;
  $('#radar-expand').textContent = expanded ? '折叠家族' : '展开家族';
  $('#radar-family-list').innerHTML = families.map(f => {
    const members = matches.filter(p => p.familyId === f.id);
    const active = expanded || openFamilies.has(f.id) || members.some(p => p.id === selected) || (!!filters.query && families.length <= 12);
    const category = catalog.categories.find(c => c.id === f.categoryId);
    return `<details class="radar-family" data-family="${escape(f.id)}" ${active ? 'open' : ''}><summary><span class="radar-family-title">${escape(f.name)}<small class="radar-family-meta">${escape(f.id)}${filters.category ? '' : ' · '+escape(category.name)}</small></span><span class="radar-family-size">${members.length}命题</span></summary>${members.map(p => `<button class="radar-proposition" data-proposition="${escape(p.id)}" aria-pressed="${selected === p.id}"><span class="radar-prop-name">${escape(p.name)}</span><span class="radar-prop-question">${prose(p.plainOverview)}</span><span class="radar-prop-footer">${chip(p.progress.stage)}${p.indirectHistoryOnly ? chip('历史引述 · 原件缺失','history') : ''}<span class="radar-id">${escape(p.id)}</span></span></button>`).join('')}</details>`;
  }).join('') || '<div class="radar-empty">没有匹配的命题。调整关键词或清除筛选后重试。</div>';
  if (selected) detail(matches.find(p => p.id === selected));
  else { $('#radar-detail').innerHTML = '<p class="radar-detail-placeholder">没有匹配命题，请调整筛选。</p>'; $('#radar-detail').classList.remove('open'); }
}
function render() { renderNavigation(); renderResults(); }
function closeDetail() { $('#radar-detail').classList.remove('open'); const selectedButton = [...document.querySelectorAll('[data-proposition],[data-pending]')].find(b => b.dataset.proposition === selected || b.dataset.pending === selected); selectedButton?.focus({preventScroll:true}); }
async function load() {
  try {
    const response = await fetch('/api/radar'); const result = await response.json();
    if (response.status === 404) {
      $('#radar-totals').textContent = '尚未导入记录'; $('#radar-family-list').innerHTML = '<div class="radar-empty">通过左侧“导入Radar”选择备选库JSON，先查看内容预览。</div>'; return;
    }
    if (!response.ok) throw new Error(result.error || 'Radar读取失败');
    catalog = validateRadarCatalog(result); revision = result.revision; fillFilters(); render();
  } catch (e) { message(`${e.message}。请检查本机服务后刷新。`, true); }
}
$('#radar-categories').addEventListener('click', e => {
  const button = e.target.closest('[data-category]'); if (!button) return;
  mode='main';filters.category=button.dataset.category;render();
});
$('#radar-pending').onclick = () => { if (catalog) { mode='pending';selected=null;render(); } };
for (const [key, selector] of Object.entries(fieldIds)) $(selector).addEventListener(key==='query'?'input':'change',()=> { filters[key]=$(selector).value;renderResults(); });
$('#radar-reset').onclick = () => { for (const [key,selector] of Object.entries(fieldIds)) { filters[key]='';$(selector).value=''; } renderResults(); };
$('#radar-expand').onclick = () => { expanded=!expanded;openFamilies.clear();renderResults(); };
$('#radar-family-list').addEventListener('toggle', e => {
  const family = e.target.closest?.('[data-family]'); if (!family) return;
  if (family.open) openFamilies.add(family.dataset.family); else openFamilies.delete(family.dataset.family);
}, true);
$('#radar-family-list').addEventListener('click', e => {
  const button=e.target.closest('[data-proposition],[data-pending]'); if (!button) return;
  selected=button.dataset.proposition || button.dataset.pending;
  document.querySelectorAll('#radar-family-list [aria-pressed]').forEach(b => b.setAttribute('aria-pressed',String(b===button)));
  if (mode==='pending') pendingDetail(catalog.pending.find(p=>p.id===selected),true);
  else detail(catalog.propositions.find(p=>p.id===selected),true);
});
$('#radar-detail').addEventListener('click',e=> {
  if (e.target.closest('[data-close-detail]')) return closeDetail();
  const button=e.target.closest('[data-related]');if (!button) return;
  selected=button.dataset.related; const prop=catalog.propositions.find(p=>p.id===selected);
  filters={category:familyFor(prop).categoryId,query:'',stage:'',problem:'',acoustic:'',keyword:''};mode='main';fillFilters();render();detail(prop,true);
});
document.addEventListener('keydown',e=> { if(e.key==='Escape'&&!document.querySelector('dialog[open]'))closeDetail(); });
$('#radar-export').onclick = () => {
  if (!catalog) return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(catalog,null,2)],{type:'application/json'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`${catalog.catalogId}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('#radar-import').onclick = () => $('#radar-import-file').click();
$('#radar-import-file').onchange = async e => {
  const file=e.target.files[0];if (!file) return;
  try {
    if (file.size>5_000_000) throw new Error('Radar导入文件不能超过5 MB');
    incoming=validateRadarCatalog(JSON.parse(await file.text()));const c=radarCounts(incoming);
    const unchanged=catalog&&JSON.stringify(incoming)===JSON.stringify(catalog);
    $('#radar-import-preview').innerHTML=`<p><strong>${escape(incoming.name)}</strong></p><p>${c.categories}个方向 · ${c.families}个家族 · ${c.propositions}个命题<br>${c.indirect}个历史引述条目 · ${c.pending}项收录待核对</p><p>${unchanged?'这份内容已存在，导入不会新增副本。':'这份快照将更新Radar备选库，当前Radar版本会自动备份。'}</p><p>主时间树的分支、事件和状态不参与此导入。</p>`;
    $('#radar-import-dialog').showModal();message('');
  } catch(err) { incoming=null;message(err.message,true); }
  finally { e.target.value=''; }
};
const cancelImport=()=> { incoming=null;$('#radar-import-dialog').close(); };
$('#radar-import-close').onclick=cancelImport;$('#radar-import-cancel').onclick=cancelImport;
$('#radar-import-confirm').onclick=async()=> {
  if (!incoming) return;const button=$('#radar-import-confirm');button.disabled=true;
  try {
    const response=await fetch('/api/radar',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...incoming,revision})});const result=await response.json();
    if (!response.ok)throw new Error(result.error||'导入失败');
    catalog=incoming;revision=result.revision;selected=null;filters={category:'',query:'',stage:'',problem:'',acoustic:'',keyword:''};mode='main';fillFilters();render();cancelImport();
    message(result.unchanged?'内容与当前库一致，没有新增副本。':'Radar快照已导入，主时间树记录保持原样。');
  }catch(e){message(e.message,true);cancelImport();}finally{button.disabled=false;}
};
$('#radar-about').onclick=()=> {
  $('#radar-about-content').innerHTML=catalog?`<p>${prose(catalog.overview)}</p><p>按“方向 → 问题家族 → 具体命题与来源版本”组织。家族归并不合并各分支的状态；导师材料就绪与实际讨论记录分别保存。</p><p>${radarCounts(catalog).indirect}个历史引述条目正常分类展示，并标注原件缺失。${catalog.pending.length}项状态冲突单列待核对；${catalog.metadata.excludedScopeCount}条淘汰范围只保留在原审计报告，不计入命题。</p><p>${prose(catalog.metadata.scientificStatusPolicy)}</p>${catalog.metadata.reports.map(s=>sourceLink(s,s.locator)).join('')}`:'<p>这是独立的Radar备选库页面。导入有效JSON后，可按分类、问题类型、声学作用方式、关键词和已有阶段浏览。</p>';
  $('#radar-about-dialog').showModal();
};
$('#radar-about-close').onclick=()=>$('#radar-about-dialog').close();
load();
