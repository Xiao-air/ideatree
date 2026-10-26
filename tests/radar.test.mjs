import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateRadarCatalog, radarCounts, filterRadar } from '../public/radar-model.mjs';
const catalog=JSON.parse(await readFile(new URL('./fixtures/radar-reserve.json',import.meta.url),'utf8'));
test('Radar retains history, pending scope, variants and independent state layers',()=>{
  const clean=validateRadarCatalog(catalog);
  assert.deepEqual(radarCounts(clean),{categories:2,families:3,propositions:4,pending:1,indirect:1});
  assert.equal(clean.propositions.every(p=>p.plainOverview.length>25&&p.sources.length>0),true);
  assert.equal(clean.propositions.some(p=>p.id==='P-PENDING'),false);
  assert.equal(clean.propositions.find(p=>p.id==='P-A@V1').progress.mentorReady,'False');
  assert.equal(clean.propositions.find(p=>p.id==='P-A@V2').progress.mentorReady,'True');
  assert.equal(clean.propositions.every(p=>p.progress.mentorDiscussion==='未找到讨论记录'),true);
});
test('imports reject duplicates, broken links, traversal, missing explanations and main-tree backups',()=>{
  const changed=patch=>{const value=structuredClone(catalog);patch(value);return value;};
  assert.throws(()=>validateRadarCatalog({version:1,ideas:[]}),/主时间树/);
  assert.throws(()=>validateRadarCatalog(changed(v=>v.propositions.push(v.propositions[0]))),/重复/);
  assert.throws(()=>validateRadarCatalog(changed(v=>v.propositions[0].familyId='missing')),/不存在/);
  assert.throws(()=>validateRadarCatalog(changed(v=>v.propositions[0].sources[0].path='../private.md')),/相对文本/);
  assert.throws(()=>validateRadarCatalog(changed(v=>v.propositions[0].plainOverview='')),/通俗概述/);
  assert.throws(()=>validateRadarCatalog(changed(v=>v.propositions[0].progress.stage='reject')),/淘汰/);
  assert.throws(()=>validateRadarCatalog(changed(v=>v.relations[0].to='missing')),/不存在/);
});
test('compound filters preserve distinct versions and quoted history',()=>{
  const clean=validateRadarCatalog(catalog);
  assert.equal(filterRadar(clean,{category:'SAMPLE-A'}).length,3);
  assert.equal(filterRadar(clean,{query:'历史引述'}).length,1);
  assert.deepEqual(filterRadar(clean,{query:'P-A@V1'}).map(p=>p.id),['P-A@V1']);
  assert.deepEqual(filterRadar(clean,{category:'SAMPLE-A',keyword:'版本对照',stage:'有界Deep Dive完成（通过Gate）'}).map(p=>p.id),['P-A@V1','P-A@V2']);
  assert.equal(filterRadar(clean,{category:'SAMPLE-B',query:'P-A@V1'}).length,0);
  assert.deepEqual(filterRadar(clean,{acoustic:'calibration'}).map(p=>p.id),['P-A@V1']);
  assert.equal(filterRadar(clean,{acoustic:'unknown',problem:'归因'}).length,3);
  assert.equal(filterRadar(clean,{stage:'有界Deep Dive完成（通过Gate）'}).length,2);
});
