import test from 'node:test';
import assert from 'node:assert/strict';
import {familySides,fitVertical,packLanes} from '../public/layout.mjs';

const idea=(id,start,left,right,parentId=null,side=0)=>({id,start,left,right,parentId,side});

test('separate periods reuse the nearest lane, including stopped ideas',()=>{
  const {positions,depths}=packLanes([idea('later',250,240,500),idea('earlier',50,40,190)]);
  assert.equal(positions.get('earlier').lane,1);
  assert.equal(positions.get('later').lane,1);
  assert.deepEqual(depths,[1,0]);
});
test('long titles or event labels prevent an unsafe shared lane',()=>{
  const {positions}=packLanes([idea('later',250,240,500),idea('earlier-with-long-title',50,40,280)]);
  assert.notEqual(positions.get('later').lane,positions.get('earlier-with-long-title').lane);
});
test('children stay outward on the same side',()=>{
  const {positions}=packLanes([idea('parent',50,40,400),idea('same-side',180,170,500,'parent')]);
  assert.ok(positions.get('same-side').lane>positions.get('parent').lane);
});
test('all shared lanes retain clearance for labels',()=>{
  const {positions}=packLanes([idea('root',200,190,700),idea('child',500,490,800,'root'),idea('older',50,40,180),idea('fills-gap',190,185,550)]);
  for(const a of positions.values())for(const b of positions.values()) {
    if(a.id===b.id||a.side!==b.side||a.lane!==b.lane)continue;
    assert.ok(a.right+10<=b.left||b.right+10<=a.left);
  }
});
test('mixed-status families stay together and changing status does not switch sides',()=>{
  const ideas=[{id:'parent',parentId:null,created:'2026-09-12',initialStatus:'stopped'},
    {id:'active-child',parentId:'parent',created:'2026-09-20',initialStatus:'active'},
    {id:'pending-child',parentId:'parent',created:'2026-09-21',initialStatus:'pending'},
    {id:'independent',parentId:null,created:'2026-09-16',initialStatus:'active'}];
  const sides=familySides(ideas);
  assert.equal(sides.get('parent'),sides.get('active-child'));
  assert.equal(sides.get('parent'),sides.get('pending-child'));
  assert.notEqual(sides.get('parent'),sides.get('independent'));
  ideas[1].initialStatus='pending';
  assert.deepEqual(familySides(ideas),sides);
});
test('empty data needs no lanes',()=>assert.deepEqual(packLanes([]).depths,[0,0]));
test('canvas fills its viewport as content changes and reuses the freed vertical space',()=>{
  const full=fitVertical([3,3],740),folded=fitVertical([2,2],740,80);
  assert.equal(full.height,740);assert.equal(folded.height,740);
  assert.ok(full.gap>68);assert.ok(folded.gap>=full.gap);
  assert.ok(full.axisY+3*full.gap<full.height);
});
test('sparse content is centered with bounded spacing and dense content remains readable',()=>{
  const sparse=fitVertical([1,1],900),dense=fitVertical([6,6],500);
  assert.equal(sparse.gap,112);assert.equal(sparse.height,900);
  assert.equal(sparse.axisY-sparse.gap-76,900-(sparse.axisY+sparse.gap)-46);
  assert.ok(dense.gap>=64);assert.ok(dense.height>=122+12*64);
});

