const source = require('../data/trip-data')
const suppliers = require('./supplier-adapters')
const clone = x => JSON.parse(JSON.stringify(x))
const seedPlaces = source.places.map(p => {
  const n = source.routeNodes.find(x => x.id === p.routeNodeId)
  return { id: p.id, name: p.name, city: p.name, latitude: n.latitude, longitude: n.longitude,
    source: '2025 年亲历资料', summary: p.planningProfile.suitableFor, tips: p.planningProfile.transportChallenge,
    category: ['harbin', 'changchun'].includes(p.id) ? '人文' : '自然', address: p.name, stayDays: 1 }
})
const MODES = ['高铁', '火车', '飞机', '大巴', '自驾']
function day(date, offset) {
  const d = new Date(date + 'T12:00:00+08:00'); d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
function validDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !isNaN(new Date(v + 'T12:00:00Z')) && day(v, 0) === v }
function today() { const d = new Date(Date.now() + 8 * 3600000); return d.toISOString().slice(0, 10) }
function defaults() { return { startDate: day(today(), 1), days: 5, budget: 4000, budgetType: '人均', people: 1, preference: '自然', pace: '均衡', modes: ['高铁','火车','大巴'], allowNight: false, needHotel: true, hotelLevel: '经济', origin: '我的出发地', constraints: '', reference: '', specialNeeds: '' } }
function validate(req, stops) {
  const errors = {}
  if (!validDate(req.startDate)) errors.startDate = '请选择有效的出发日期'
  if (!Number.isInteger(Number(req.days)) || Number(req.days) < 1 || Number(req.days) > 30) errors.days = '总天数为 1–30 天整数'
  if (!Number.isInteger(Number(req.people)) || Number(req.people) < 1 || Number(req.people) > 20) errors.people = '人数为 1–20 人整数'
  if (!Number.isFinite(Number(req.budget)) || Number(req.budget) <= 0) errors.budget = '请输入大于 0 的预算'
  if (!req.modes || !req.modes.length || req.modes.some(m => !MODES.includes(m))) errors.modes = '至少接受一种交通方式'
  if (!['自然', '人文', '均衡'].includes(req.preference)) errors.preference = '请选择自然/人文偏好'
  if (!stops.length) errors.stops = '请先在地图上选择地点'
  if (new Set(stops.map(s=>s.id)).size !== stops.length) errors.stops = '同一地点不能重复添加'
  if (stops.some(s => !s.id || !Number.isInteger(Number(s.stayDays)) || s.stayDays < 1 || s.stayDays > 30)) errors.stops = '每地停留需为 1–30 天'
  if (stops.some(s => s.canAdd === false || s.planningRole === 'choose_city' || s.isProvince === true || (s.recognitionStatus && !['confirmed', 'legacy'].includes(s.recognitionStatus)) || (s.objectType === 'coordinate' && s.recognitionStatus !== 'confirmed'))) errors.stops = '请先确认地点类型；省级行政区需继续选择城市'
  if (stops.reduce((n,s) => n + Number(s.stayDays), 0) > Number(req.days)) errors.days = '地点停留总天数超过旅行天数'
  return errors
}
function total(plan) {
  plan.estimate = plan.items.reduce((sum,i) => sum + i.price * i.quantity, 0)
  plan.budgetLimit = Number(plan.request.budget) * (plan.request.budgetType === '人均' ? Number(plan.request.people) : 1)
  plan.overBudget = Math.max(0, plan.estimate - plan.budgetLimit)
  plan.warnings = ['当前为本地演示库存，不代表真实班次、房源、票量或价格；未包含餐饮、接驳及其他个人消费。']
  if (plan.overBudget) plan.warnings.push('当前已知费用超预算 ¥' + plan.overBudget + '；可修改或选择“省钱”重规划')
  if (plan.request.constraints) plan.warnings.push('自由文本约束已记录，当前本地引擎仅执行表单枚举约束；请逐项核对：' + plan.request.constraints)
  return plan
}
function buildDemands(request,stops) {
  const demands=[],sum=stops.reduce((n,s)=>n+s.stayDays,0);let cursor=0
  stops.forEach((s,index)=>{
    const destinationType = s.planningRole === 'destination_area' || s.isCity === true ? 'destination_area' : 'stop'
    const pointCoordinates = destinationType === 'stop' ? { latitude: s.latitude, longitude: s.longitude } : {}
    const duration=s.stayDays+(index===stops.length-1?request.days-sum:0),date=day(request.startDate,cursor)
    demands.push({id:'transport-'+s.id,category:'transport',stopId:s.id,from:index?stops[index-1].name:request.origin,to:s.name,toType:destinationType,date,quantity:request.people,modes:request.modes,allowNight:request.allowNight})
    const nights=Math.min(duration,request.days-1-cursor)
    if(request.needHotel&&nights>0)demands.push(Object.assign({id:'hotel-'+s.id,category:'hotel',stopId:s.id,city:s.name,locationType:destinationType,date,endDate:day(date,nights),nights,rooms:Math.ceil(request.people/2),quantity:Math.ceil(request.people/2),hotelLevel:request.hotelLevel}, pointCoordinates))
    for(let n=0;n<duration;n++)demands.push(Object.assign({id:'ticket-'+s.id+'-'+n,category:'ticket',stopId:s.id,city:s.name,locationType:destinationType,date:day(date,n),start:n===0?'15:00':'09:00',end:n===0?'17:00':'12:00',quantity:request.people,preference:request.preference,pace:request.pace}, pointCoordinates))
    cursor+=duration
  })
  return demands
}
function quoteToItem(demand,quote,request,updatedAt){
  const type=demand.category==='transport'?(quote.mode==='飞机'?'flight':'train'):demand.category
  const item={id:demand.id,type,stopId:demand.stopId,placeId:demand.stopId,title:quote.title,variant:quote.variant,date:quote.date,start:quote.start,end:quote.end,price:quote.unitPrice,quantity:demand.category==='hotel'?demand.nights*demand.rooms:demand.quantity,reason:quote.reason,source:quote.providerName,isDemo:quote.isDemo,bookingState:'待预订',quoteState:'quoted',quote:clone(quote),updatedAt}
  ;['mode','serviceNo','from','to','endDate','nights','rooms','latitude','longitude'].forEach(k=>{if(quote[k]!==undefined)item[k]=quote[k]})
  return item
}
function preserveBookings(plan,existing){
  if(!existing)return
  plan.items.forEach(i=>{const old=existing.items.find(x=>x.id===i.id);if(old&&old.booking){i.booking=clone(old.booking);i.bookingState=(old.date===i.date&&old.from===i.from&&old.to===i.to&&old.endDate===i.endDate)?old.bookingState:'待核对'}})
}
function evaluate(plan){
  const blockers=validateItems(plan),warnings=[]
  plan.items.forEach(i=>{
    if(!i.quote)blockers.push(i.title+' 缺少供应商报价')
    else if(i.quote.status!=='available')blockers.push(i.title+' 库存不可用')
    if(i.quoteState==='detached')warnings.push(i.title+' 已手动修改，原报价仅供参考，购买前需重新核对')
  })
  if(plan.items.length<plan.demands.length)blockers.push('部分交通、住宿或门票需求没有可用库存')
  const unique=Array.from(new Set(blockers)),review=warnings.length>0
  plan.execution={status:unique.length?'blocked':review?'needs_review':'ready',label:unique.length?'不可执行':review?'需人工核对':'演示校验通过',checkedAt:new Date().toISOString(),inventoryMode:'mock',blockers:unique,warnings}
  return plan
}
function assemble(req,inputStops,existing,candidateGroups) {
  const errors = validate(req,inputStops)
  if (Object.keys(errors).length) { const e = new Error(Object.values(errors).join('；')); e.fields = errors; throw e }
  const request = Object.assign({}, req, { days: Number(req.days), people: Number(req.people), budget: Number(req.budget) })
  const stops = clone(inputStops).map(s => Object.assign(s, { stayDays: Number(s.stayDays) }))
  const plan = { id: existing ? existing.id : 'plan-' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    version: existing ? existing.version + 1 : 1, request, stops, items: [], demands:buildDemands(request,stops), suppliers:suppliers.summary(), isDemo: true, createdAt: existing ? existing.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString() }
  plan.demands.forEach((d,index)=>{const quote=suppliers.choose(candidateGroups[index]||[],d);if(quote)plan.items.push(quoteToItem(d,quote,request,plan.updatedAt))})
  preserveBookings(plan,existing)
  return evaluate(total(plan))
}
function generate(req,inputStops,existing){
  const request=Object.assign({},req,{days:Number(req.days),people:Number(req.people),budget:Number(req.budget)}),stops=clone(inputStops).map(s=>Object.assign(s,{stayDays:Number(s.stayDays)}))
  const demands=buildDemands(request,stops)
  return assemble(req,inputStops,existing,demands.map(d=>suppliers.searchSync(d,{request,stops})))
}
async function generateAsync(req,inputStops,existing){
  const request=Object.assign({},req,{days:Number(req.days),people:Number(req.people),budget:Number(req.budget)}),stops=clone(inputStops).map(s=>Object.assign(s,{stayDays:Number(s.stayDays)}))
  const demands=buildDemands(request,stops),groups=await Promise.all(demands.map(d=>suppliers.search(d,{request,stops})))
  return assemble(req,inputStops,existing,groups)
}
function validateItems(plan) {
  const errors=[]
  plan.items.forEach(i=>{
    if(!i.title.trim()) errors.push('推荐项名称不能为空')
    if(!validDate(i.date)||i.date<plan.request.startDate||i.date>day(plan.request.startDate,plan.request.days-1)) errors.push(i.title+' 日期不在旅程范围内')
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(i.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(i.end)) errors.push(i.title+' 时间应为 HH:mm')
    if(i.type!=='hotel'&&i.end<=i.start) errors.push(i.title+' 结束时间需晚于开始时间（本地版本不生成跨夜票）')
    if(!Number.isFinite(Number(i.price))||Number(i.price)<0) errors.push(i.title+' 单价无效')
    if(i.type==='hotel'&&(!validDate(i.endDate)||i.endDate<=i.date||i.endDate>day(plan.request.startDate,plan.request.days))) errors.push(i.title+' 退房日期必须晚于入住且在旅程范围内')
  })
  const timeItems=plan.items.filter(i=>i.type!=='hotel').slice().sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start))
  timeItems.forEach((i,n)=>{const prev=timeItems[n-1];if(prev&&prev.date===i.date&&prev.end>i.start) errors.push(prev.title+' 与 '+i.title+' 时间冲突')})
  return Array.from(new Set(errors))
}
function replan(plan,ids,constraint,goal) {
  if(!ids.length) throw new Error('请先选择地点/交通/住宿卡片')
  if(ids.some(id=>!plan.items.some(i=>i.id===id))) throw new Error('所选推荐已失效，请重新选择')
  const next=clone(plan);next.version++;next.updatedAt=new Date().toISOString()
  next.items.forEach(i=>{
    if(!ids.includes(i.id))return
    const booking=i.booking&&clone(i.booking)
    const demand=(next.demands||[]).find(d=>d.id===i.id),candidates=demand?suppliers.searchSync(demand,{request:next.request,stops:next.stops,goal}):[]
    const alternatives=candidates.filter(q=>!i.quote||q.quoteId!==i.quote.quoteId),quote=suppliers.choose(alternatives,demand||{},goal)
    if(quote){const replacement=quoteToItem(demand,quote,next.request,next.updatedAt);Object.keys(i).forEach(k=>delete i[k]);Object.assign(i,replacement)}
    i.reason=(i.reason||'本地备选')+'；调整目标：'+goal+'；补充约束：'+(constraint||'无')
    if(booking){i.booking=booking;i.bookingState='待核对'}
  })
  next.replanNote={ids,constraint,goal}
  return evaluate(total(next))
}
function markItemEdited(item){if(item.quote){item.quoteState='detached';item.bookingState=item.booking?'待核对':'待预订'}return item}
function mapData(plan,selected) {
  const valid=p=>Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))
  const markers=plan.stops.filter(valid).map((s,n)=>({id:n+1,stopId:s.id,latitude:Number(s.latitude),longitude:Number(s.longitude),width:24,height:28,callout:{content:s.name,display:'ALWAYS',padding:4,fontSize:12}}))
  plan.items.filter(i=>i.type==='hotel'||(i.type==='ticket'&&i.booking&&valid(i.booking))).forEach((i,n)=>{
    const pos=i.booking&&valid(i.booking)?i.booking:i
    markers.push({id:100+n,itemId:i.id,latitude:Number(pos.latitude),longitude:Number(pos.longitude),width:22,height:24,callout:{content:(i.type==='hotel'?'住：':'玩：')+(i.booking?i.booking.title:i.title),display:'BYCLICK',padding:4,fontSize:12}})
  })
  const focus=plan.items.find(i=>i.id===selected)
  if(focus){const m=markers.find(m=>m.itemId===focus.id)||markers.find(m=>m.stopId===focus.stopId);if(m)m.callout={content:focus.booking?focus.booking.title:focus.title,display:'ALWAYS',padding:6,fontSize:14,bgColor:'#333333',color:'#ffffff'}}
  const points=plan.stops.filter(valid).map(s=>({latitude:Number(s.latitude),longitude:Number(s.longitude)}))
  const polyline=points.slice(1).map((p,n)=>({id:n+1,points:[points[n],p],width:focus&&focus.id==='transport-'+plan.stops[n+1].id?6:3,color:focus&&focus.id==='transport-'+plan.stops[n+1].id?'#222222':'#999999',dottedLine:true}))
  return {markers,includePoints:markers.map(m=>({latitude:m.latitude,longitude:m.longitude})),polyline}
}
// total 只在线性金额齐全时计算：真实行程的 item 没有报价，必须保持 null 而不是 ¥0。
function viewItems(plan) { return plan.items.map(i=>Object.assign({},i,{total:Number.isFinite(Number(i.price))&&Number.isFinite(Number(i.quantity))?Number(i.price)*Number(i.quantity):null,typeName:i.type==='hotel'?'酒店':i.type==='ticket'?'景点/门票':'交通',timeText:i.date+' '+i.start+' → '+(i.endDate?i.endDate+' ':'')+i.end})) }
const seedPosts=[{id:'seed-route',authorId:'seed',authorName:'路线资料员',type:'route',title:'兴安岭公共交通路线参考',content:'来自项目 2025 年 7 月真实行程资料。班次、价格和开放信息均为历史记录，请出发前核验。',placeNames:['哈尔滨','漠河','满归'],visibility:'public',createdAt:'2025-07-12T12:00:00Z',photos:[],answers:[],referenceId:'seed-route',isSeed:true}]
// 2026-09-18 Owner 决定：本地演示方案链路下线（菜单不再生成演示库存，方案页不再编辑/部分重规划）。
// generate / generateAsync / replan / evaluate / markItemEdited 保留给测试与历史数据，但已无页面调用点；
// 行程页仍在复用的是 day / today / validDate / viewItems / mapData 这些纯函数。
module.exports={seedPlaces,seedPosts,MODES,defaults,validate,generate,generateAsync,validateItems,evaluate,markItemEdited,replan,mapData,viewItems,total,day,today,validDate}
