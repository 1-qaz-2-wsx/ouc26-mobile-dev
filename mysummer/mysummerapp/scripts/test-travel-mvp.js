/* Run: node mysummerapp/scripts/test-travel-mvp.js
   Pure Node tests; all wx APIs are mocked, no network / user data writes. */
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const memory=new Map();let failWrite=false,lastNavigation=''
const clone=x=>JSON.parse(JSON.stringify(x))
global.wx={
 getStorageSync:k=>memory.has(k)?clone(memory.get(k)):'',
 setStorageSync:(k,v)=>{if(failWrite)throw new Error('quota exceeded');memory.set(k,clone(v))},
 showToast:()=>{},showModal:o=>o.success({confirm:true}),
 navigateTo:o=>{lastNavigation=o.url},redirectTo:o=>{lastNavigation=o.url},switchTab:o=>{lastNavigation=o.url},navigateBack:()=>{},
 request:()=>{throw new Error('Tests must not use network')},
 setClipboardData:()=>{},createSelectorQuery:()=>({in(){return this},selectAll(){return this},boundingClientRect(fn){fn([]);return this},exec(){}})
}
const store=require('../utils/travel-store'),engine=require('../utils/travel-engine'),ui=require('../utils/travel-ui'),services=require('../utils/travel-services')
let count=0
function test(name,fn){fn();count++;console.log('PASS '+name)}
function page(name,query){let def;global.Page=d=>{def=d};const file=require.resolve('../pages/'+name+'/'+name);delete require.cache[file];require(file);const p=Object.assign({},def,{data:clone(def.data||{}),setData(values){for(const [k,v] of Object.entries(values)){const bits=k.split('.');let o=this.data;for(let n=0;n<bits.length-1;n++)o=o[bits[n]]||(o[bits[n]]={});o[bits[bits.length-1]]=v}}});if(p.onLoad)p.onLoad(query||{});if(p.onShow)p.onShow();if(p.onReady)p.onReady();return p}
const event=(dataset,value)=>({currentTarget:{dataset},detail:{value}})
async function main(){
 const req=Object.assign(engine.defaults(),{startDate:'2026-10-01',days:4})
 const stops=engine.seedPlaces.slice(0,2)
 let plan
 test('empty menu and invalid constraints rejected',()=>{assert.ok(engine.validate(req,[]).stops);assert.ok(engine.validate({...req,days:0},stops).days);assert.ok(engine.validate({...req,modes:[]},stops).modes);assert.ok(engine.validate({...req,people:0},stops).people);assert.ok(!engine.validDate('2026-02-30'))})
 test('complete local plan includes executable normalized supplier quotes',()=>{plan=engine.generate(req,stops);for(const type of ['train','hotel','ticket'])assert.ok(plan.items.some(i=>i.type===type));assert.equal(engine.validateItems(plan).length,0);assert.equal(plan.execution.status,'ready');assert.equal(plan.demands.length,plan.items.length);assert.ok(plan.items.every(i=>i.quote&&i.quote.provider&&i.quote.providerProductId&&i.quote.quoteId&&i.quote.currency==='CNY'&&i.quote.fetchedAt&&i.quote.expiresAt));assert.ok(plan.items.every(i=>i.date>='2026-10-01'&&i.date<='2026-10-04'));assert.ok(plan.estimate>0)})
 test('mode / hotel / budget constraints',()=>{const p=engine.generate({...req,needHotel:false,modes:['飞机'],budget:1},stops);assert.ok(!p.items.some(i=>i.type==='hotel'));assert.ok(p.items.some(i=>i.type==='flight'));assert.ok(p.overBudget>0)})
 test('menu deduplicates places',()=>{store.addPlace(stops[0]);store.addPlace(stops[0]);assert.equal(store.read().menu.length,1)})
 test('storage failure keeps last valid state',()=>{failWrite=true;assert.throws(()=>store.addPlace(stops[1]));failWrite=false;assert.equal(store.read().menu.length,1)})
 test('guest and demo account are isolated',()=>{services.demoLogin();assert.equal(store.read().menu.length,0);store.setSession({kind:'guest',id:'guest',nickname:'游客'});assert.equal(store.read().menu.length,1)})
 test('plan save survives cold cache and stale overwrite rejected',()=>{store.putPlan(plan);store.resetCache();assert.equal(store.getPlan(plan.id).items.length,plan.items.length);assert.throws(()=>store.putPlan({...plan,estimate:1}))})
 test('partial replan only changes selected items and preserves original',()=>{const original=JSON.stringify(plan);const next=engine.replan(plan,[plan.items[0].id],'希望便宜','省钱');assert.equal(JSON.stringify(plan),original);assert.deepEqual(next.items.slice(1),plan.items.slice(1));assert.ok(next.items[0].price<plan.items[0].price);assert.throws(()=>engine.replan(plan,[],'','省钱'))})
 test('manual edits detach the supplier quote and require review',()=>{const p=clone(plan),item=p.items[0];item.title='用户手动填写';engine.markItemEdited(item);engine.evaluate(engine.total(p));assert.equal(item.quoteState,'detached');assert.equal(p.execution.status,'needs_review')})
 // 2026-09-18：行程不再带提醒；开启行程是幂等的纯数据操作。
 test('start journey is idempotent and never schedules reminders',()=>{store.startTrip(plan);store.startTrip(plan);const trip=store.read().trips[0];assert.equal(store.read().trips.length,1);assert.equal(trip.reminders,undefined);assert.equal(trip.messageState,undefined);assert.equal(trip.advanceMinutes,undefined);assert.equal(trip.status,'active')})
 test('putPlan refreshes the active trip plan without reminder bookkeeping',()=>{const p=clone(plan);p.version++;p.items[0].start='07:30';store.putPlan(p);assert.equal(store.read().trips[0].plan.version,2);assert.equal(store.read().trips[0].messageState,undefined);plan=p})
 test('homepage, menu, me, place, itinerary, community pages load',()=>{for(const name of ['me','index','menu','itinerary','community','post-edit','member']){const p=page(name,{id:'seed'});assert.ok(!p.data.error,name+': '+p.data.error)}assert.ok(page('place-detail',{id:stops[0].id}).data.place);assert.ok(page('post-detail',{id:'seed-route'}).data.post)})
 test('plan and booking pages are the 2026-09-18 real-only versions',()=>{
   // 方案页只认真实规划结果：本地方案 id 已经打不开，也读不到旧的可编辑视图。
   const pd=page('plan-detail',{id:plan.id})
   assert.equal(pd.data.ready,false)
   assert.equal(pd.data.plan,undefined,'plan-detail 不再暴露可编辑的本地方案对象')
   assert.equal(typeof pd.edit,'undefined','方案编辑已下线')
   assert.equal(typeof pd.replan,'undefined','选择部分重新规划已下线')
   assert.equal(typeof pd.regenerate,'function')
   assert.equal(typeof pd.start,'function')
   assert.equal(typeof pd.supplement,'function')
   // 补充信息页只认 sectionId + 缓存里的真实方案；旧的 itemId 入口不再可用。
   const bk=page('booking',{planId:plan.id,itemId:plan.items[0].id})
   assert.equal(bk.data.item,undefined,'booking 不再暴露可核验的演示商品')
   assert.equal(typeof bk.buy,'undefined','第三方跳转已从补充信息页删除')
   assert.equal(typeof bk.importOrder,'undefined','「从已有信息自动填入」已删除')
   assert.equal(typeof bk.save,'function')
 })
 test('private posts excluded from community and only owner namespace visible',()=>{store.mutate(s=>s.posts.push({id:'private',authorId:'guest',authorName:'游客',visibility:'private',createdAt:new Date().toISOString(),placeNames:[],answers:[],title:'隐藏'}));assert.ok(!ui.posts().some(p=>p.id==='private'))})
 test('local community publish / answer / hide workflow',()=>{services.demoLogin();const p=page('post-edit');p.setData({typeIndex:2,title:'漠河怎么去',content:'希望乘火车',places:'漠河'});p.publish();const post=store.read().posts[0];assert.equal(post.type,'question');const detail=page('post-detail',{id:post.id});detail.setData({answer:'先查询可达车站'});detail.reply();assert.equal(store.read().posts[0].answers.length,1);detail.visibility();assert.ok(!ui.posts().some(p=>p.id===post.id));store.setSession({kind:'guest',id:'guest',nickname:'游客'})})
 test('trip record persists and public trips follow hide switch',()=>{const p=page('itinerary');const item=p.data.items[0];p.record(event({id:item.id}));p.setData({note:'今天很开心'});p.saveRecord();let t=store.read().trips[0];assert.equal(t.records[item.id].note,'今天很开心');t.status='completed';t.visibility='public';t.finishedAt=new Date().toISOString();store.updateTrip(t);assert.ok(ui.posts().some(p=>p.id===t.id));t.visibility='private';store.updateTrip(t);assert.ok(!ui.posts().some(p=>p.id===t.id))})
 test('app route set and event handlers are valid',()=>{const root=path.join(__dirname,'..'),app=require('../app.json');assert.equal(app.pages[0],'pages/me/me');assert.equal(app.tabBar.list.length,5);for(const route of app.pages){for(const ext of ['js','json','wxml','wxss'])assert.ok(fs.existsSync(path.join(root,route+'.'+ext)),route);let def;global.Page=d=>def=d;const file=path.join(root,route+'.js');delete require.cache[require.resolve(file)];require(file);const markup=fs.readFileSync(path.join(root,route+'.wxml'),'utf8');for(const m of markup.matchAll(/(?:bind|catch)(?:\w+|:\w+)="([a-zA-Z]\w*)"/g))assert.equal(typeof def[m[1]],'function',route+' missing '+m[1]);new vm.Script(fs.readFileSync(file,'utf8'));JSON.parse(fs.readFileSync(path.join(root,route+'.json'),'utf8'))}})
 // 2026-09-18：行程提醒功能搁置废弃——前端不再有订阅消息入口，也没有提醒排程路由。
 assert.equal(services.subscribe,undefined);assert.equal(require('../config/endpoints').notImplemented,undefined)
 count++;console.log('PASS reminder chain is removed from the client (no subscribe, no schedule route)')
 const checked=await services.revalidateQuote(plan.items[0]);assert.equal(checked.available,true);const detached=clone(plan.items[0]);engine.markItemEdited(detached);assert.equal((await services.revalidateQuote(detached)).available,false);count++;console.log('PASS quote is revalidated before purchase')
 await assert.rejects(services.openProvider(plan.items[0]),/演示库存|未配置/);count++;console.log('PASS demo booking navigation fails safely')
 console.log('\n'+count+' tests passed. No network calls or real storage writes.')
}
main().catch(e=>{console.error(e);process.exitCode=1})
