const clone=x=>JSON.parse(JSON.stringify(x))
const MODE_PRICE={高铁:180,火车:110,飞机:560,大巴:90,自驾:160}
function hash(text){let value=0;for(const c of String(text))value=(value*31+c.charCodeAt(0))%997;return value}
function stamp(context){return context&&context.now?new Date(context.now):new Date()}
function quoteBase(demand,index,context){
  const now=stamp(context),suffix=hash(demand.id+'-'+index)
  return {quoteId:'mock-q-'+demand.id+'-'+index,provider:'mock-local',providerName:'本地演示库存',providerProductId:'mock-p-'+suffix,category:demand.category,status:'available',availability:Math.max(demand.quantity||1,8-index*2),currency:'CNY',fetchedAt:now.toISOString(),expiresAt:new Date(now.getTime()+2*3600000).toISOString(),isDemo:true,bookingTarget:{kind:'manual',label:'演示库存不可直接购买'}}
}
function transport(d,index,context){
  const mode=d.modes[index%d.modes.length],base=quoteBase(d,index,context),price=(MODE_PRICE[mode]||150)+index*35
  return Object.assign(base,{mode,title:mode+' '+(index?'DEMO-B':'DEMO-A')+String(hash(d.id)).padStart(3,'0'),serviceNo:(mode==='飞机'?'DM':'D')+String(hash(d.id)+index),variant:mode==='飞机'?'经济舱':mode==='自驾'?'车辆费用估算':'二等/普通座',from:d.from,to:d.to,date:d.date,start:index?'10:00':'08:00',end:index?'13:30':'11:00',unitPrice:price,reason:'演示候选：满足出发日期、人数及已选交通方式'})
}
function hotel(d,index,context){
  const base=quoteBase(d,index,context),comfortable=d.hotelLevel==='舒适'
  return Object.assign(base,{title:d.city+(index?'演示酒店 B':'演示酒店 A'),variant:comfortable?'舒适双床房':'经济双床房',date:d.date,endDate:d.endDate,start:'14:00',end:'12:00',nights:d.nights,rooms:d.rooms,unitPrice:(comfortable?320:180)+index*40,latitude:d.latitude,longitude:d.longitude,reason:'演示候选：覆盖所需入住日期与房间数'})
}
function ticket(d,index,context){
  const base=quoteBase(d,index,context)
  return Object.assign(base,{title:d.city+(d.preference==='人文'?'人文体验':'自然漫游')+(index?' B':' A'),variant:'成人日间票',date:d.date,start:d.start,end:d.end,unitPrice:60+index*20,latitude:d.latitude,longitude:d.longitude,reason:'演示候选：按偏好与当天空闲时段匹配'})
}
function searchSync(demand,context){
  let list=[]
  if(demand.category==='transport')list=[transport(demand,0,context),transport(demand,1,context)]
  if(demand.category==='hotel')list=[hotel(demand,0,context),hotel(demand,1,context)]
  if(demand.category==='ticket')list=[ticket(demand,0,context),ticket(demand,1,context)]
  if(context&&context.goal==='省钱'&&list.length){const promo=clone(list.slice().sort((a,b)=>a.unitPrice-b.unitPrice)[0]);promo.quoteId+='-promo';promo.providerProductId+='-promo';promo.title+=' · 限时演示价';promo.unitPrice=Math.round(promo.unitPrice*0.82);promo.reason='演示候选：按省钱目标重新选品';list.push(promo)}
  return list
}
function revalidate(quote,context){
  const now=stamp(context),expired=new Date(quote.expiresAt).getTime()<=now.getTime()
  return Promise.resolve({available:quote.status==='available'&&!expired,status:expired?'expired':quote.status,checkedAt:now.toISOString(),quote:clone(quote),message:expired?'演示报价已过期，请重新生成方案':'演示库存核验通过；它不代表真实平台库存'})
}
module.exports={id:'mock-local',name:'本地演示库存',isDemo:true,searchSync,search:(d,c)=>Promise.resolve(searchSync(d,c)),revalidate}
