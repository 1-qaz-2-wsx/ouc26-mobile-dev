const s=require('../../utils/travel-store'),e=require('../../utils/travel-engine'),u=require('../../utils/travel-ui'),api=require('../../utils/travel-services'),travelSync=require('../../utils/travel-sync')

/* 我的行程 · 页面级派生视图（只读 plan / records，不改 travel-store schema）
   结构：左侧日期轴 + 右侧「多旅行切换 / 当天记录卡 / 收尾」；
   视觉真值：specs/frontend-refactor/design-system-contract.md（G0 令牌 + 组件语法）。
   本页只做两件派生：按天的分组、记录卡的展示字段（类型 / 时间 / 状态 / 备注 / 照片）。
   不新造后端事实，也不读 plan 的内部校验结构。 */
const DATE=/^\d{4}-\d{2}-\d{2}$/
const TITLE_HOME='我的行程'
const TITLE_RECORD='行程记录'
const KIND={hotel:'lodging',ticket:'place'}
/* 三类内容语法。item.type 只有 hotel / ticket / train / flight（travel-engine §58），
   其余一律按交通处理，保证旧缓存里的自定义类型仍有稳定标签。 */
function kindOf(type){return KIND[type]||'transport'}

function addDays(date,offset){
  const d=new Date(date+'T12:00:00+08:00')
  d.setUTCDate(d.getUTCDate()+offset)
  return d.toISOString().slice(0,10)
}
/* 轴上日期用 M/D（9/21），行程 chip 用 MM-DD（09-21）：两处都能一眼看出是哪天，但轴更短。 */
function mmdd(date){return DATE.test(date||'')?date.slice(5):''}
function md(date){
  if(!DATE.test(date||''))return''
  return Number(date.slice(5,7))+'/'+Number(date.slice(8,10))
}
function setTitle(title){
  try{if(typeof wx!=='undefined'&&typeof wx.setNavigationBarTitle==='function')wx.setNavigationBarTitle({title})}catch(_){}
}
/* 行程天数轴：以 plan.request 的 startDate/days 为骨架，并入方案里实际出现的日期。
   只做展示派生，不写回 plan。 */
function dayGroups(trip,items){
  const req=(trip&&trip.plan&&trip.plan.request)||{}
  const total=Number(req.days)
  const keys=[],seen={}
  const add=k=>{if(DATE.test(k||'')&&!seen[k]){seen[k]=1;keys.push(k)}}
  if(DATE.test(req.startDate||'')&&total>0&&total<=31)for(let i=0;i<total;i++)add(addDays(req.startDate,i))
  items.forEach(it=>add(it.date))
  keys.sort()
  const byDate={}
  items.forEach(it=>{(byDate[it.date]=byDate[it.date]||[]).push(it)})
  const today=e.today()
  return keys.map((k,i)=>({
    key:k,label:md(k),dayNo:i+1,isToday:k===today,
    items:(byDate[k]||[]).slice().sort((a,b)=>String(a.start||'').localeCompare(String(b.start||'')))
  }))
}
/* 把 travel-store 里的 records 与 plan.stops 合并进记录卡（只读）。
   meta 只由既有字段拼装：到达时间 / 预订状态 / 报价失效 / 数据来源。 */
function decorate(list,records){
  return (list||[]).map(it=>{
    const record=(records||{})[it.id]||{}
    const kind=kindOf(it.type)
    const meta=[]
    if(kind==='transport'&&it.end)meta.push('到达 '+it.end)
    if(it.quoteState==='detached')meta.push('报价已失效')
    else if(it.bookingState)meta.push(it.bookingState)
    // 来源名本身可能已经写明「本地演示库存」，不重复标注
    if(it.isDemo&&!/演示/.test(String(it.source||'')))meta.push('演示库存')
    if(it.source)meta.push(it.source)
    // 用户自己补充的实际信息（车次/席别/房型/金额）。只展示他填过的字段，不推算、不补 0。
    const booking=it.booking||null
    const bookingLine=booking?[
      kind==='lodging'?String(booking.name||''):String(booking.serviceNo||booking.flightNo||''),
      String(booking.seatClass||booking.cabin||booking.roomType||'')+(booking.rooms?' × '+booking.rooms:''),
      booking.unitPrice?'¥'+booking.unitPrice:(booking.totalPrice?'¥'+booking.totalPrice:'')
    ].filter(Boolean).join(' · '):''
    return Object.assign({},it,{
      kind,
      typeName:kind==='lodging'?'住宿':kind==='place'?'活动':'交通',
      time:it.start||'时间未定',
      stay:kind==='lodging'?(it.date+(it.endDate?' 入住 · '+it.endDate+' 退房':' 入住')):'',
      meta:meta.join(' · '),
      flag:record.done?'已记录':'待进行',
      done:!!record.done,note:record.note||'',photos:(record.photos||[]).slice(0,6),
      // 只有真实方案物化出来的车票/航班/住宿卡才有稳定 section 身份，才能回填补充信息。
      sectionId:(it.sourceRef&&it.sourceRef.sectionId)||'',
      supplementable:Boolean(it.sourceRef&&it.sourceRef.sectionId)&&(kind==='lodging'||kind==='transport'),
      supplemented:Boolean(booking),
      bookingLine
    })
  })
}
Page({
  data:{trips:[],chips:[],trip:null,items:[],days:[],dayKey:'',dayNo:0,dayItems:[],
    error:'',recordId:'',recordMeta:'',recordTitle:'',note:'',photos:[],editItem:null,busy:false},

  async onShow(){
    setTitle(this.data.recordId?TITLE_RECORD:TITLE_HOME)
    const identity=s.sessionIdentity()
    if(identity.kind==='wechat'){try{await travelSync.syncNow();if(!s.isCurrentSession(identity))return}catch(err){if(s.isCurrentSession(identity))u.fail(this,err)}}
    if(!s.isCurrentSession(identity))return
    u.run(this,()=>{this.refresh()})
  },
  onHide(){setTitle(TITLE_HOME)},

  /* 统一的只读派生入口：任何写操作后调用它重算，不额外发社区请求。 */
  refresh(){
    const trips=s.read().trips
    const trip=trips.find(t=>t.id===this.current)||trips[trips.length-1]||null
    this.current=trip?trip.id:null
    // 补充信息以本机最新记录为准（行程物化时的快照可能已被后续修改），按 section 身份合并。
    const planId=(trip&&trip.planId)||(trip&&trip.plan&&trip.plan.id)||''
    const bookings={}
    s.listBookings(planId).forEach(row=>{bookings[row.sectionId]=row})
    const items=trip?e.viewItems(trip.plan).map(it=>{
      const sectionId=(it.sourceRef&&it.sourceRef.sectionId)||''
      const row=sectionId?bookings[sectionId]:null
      return row?Object.assign({},it,{booking:row.fields,bookingKind:row.kind,bookingState:'已补充（用户记录）'}):it
    }):[]
    const days=dayGroups(trip,items)
    const kept=days.find(d=>d.key===this.dayKey)
    const active=kept||days.find(d=>d.isToday)||days[0]||null
    this.dayKey=active?active.key:''
    this.setData({
      trips,
      chips:trips.map(t=>({id:t.id,label:mmdd((t.plan&&t.plan.request&&t.plan.request.startDate)||'')+' · '+(t.status==='active'?'进行中':'已结束')})),
      trip,items,days,dayKey:this.dayKey,dayNo:active?active.dayNo:0,
      dayItems:decorate(active?active.items:[],trip&&trip.records)
    })
  },

  choose(ev){this.current=ev.currentTarget.dataset.id;this.dayKey='';this.onShow()},
  pickDay(ev){
    const key=ev.currentTarget.dataset.key
    if(!key||key===this.dayKey)return
    this.dayKey=key
    u.run(this,()=>{this.refresh()})
  },
  start(){u.tab('index')},

  record(ev){
    const id=ev.currentTarget.dataset.id
    const trip=this.data.trip
    const r=((trip&&trip.records)||{})[id]||{}
    const item=(this.data.dayItems||[]).find(i=>i.id===id)||null
    setTitle(TITLE_RECORD)
    this.setData({
      recordId:id,
      note:r.note||'',
      photos:(r.photos||[]).slice(0,6),
      editItem:item,
      recordMeta:item?('Day '+this.data.dayNo+' · '+item.time+' · '+item.typeName):'',
      recordTitle:item?item.title:''
    })
  },
  // 行程中也可以补充/修改车票、航班、住宿的实际信息；入口与方案页共用 pages/booking。
  supplement(ev){
    const sectionId=ev.currentTarget.dataset.section
    const trip=this.data.trip
    const planId=(trip&&trip.planId)||(trip&&trip.plan&&trip.plan.id)||''
    const jobId=(trip&&trip.plan&&trip.plan.sourceReal&&trip.plan.sourceReal.jobId)||''
    if(!sectionId||!planId)return
    u.open('booking','sectionId='+encodeURIComponent(sectionId)+'&planId='+encodeURIComponent(planId)+'&jobId='+encodeURIComponent(jobId))
  },
  note(ev){this.setData({note:ev.detail.value})},
  photo(){
    const identity=s.sessionIdentity()
    wx.chooseMedia({count:Math.max(1,6-this.data.photos.length),mediaType:['image'],success:async r=>{
      try{
        const paths=r.tempFiles.map(f=>f.tempFilePath)
        const saved=identity.kind==='wechat'?await api.uploadPhotos(paths,'travel/trips'):await api.savePhotos(paths)
        if(s.isCurrentSession(identity))this.setData({photos:this.data.photos.concat(saved).slice(0,6)})
      }catch(err){if(s.isCurrentSession(identity))u.fail(this,err)}
    },fail:err=>{if(s.isCurrentSession(identity)&&!/cancel/.test(err.errMsg||''))u.fail(this,new Error('照片选择失败'))}})
  },
  removePhoto(ev){this.setData({photos:this.data.photos.filter((p,i)=>i!==Number(ev.currentTarget.dataset.index))})},
  saveRecord(){u.run(this,()=>{
    const t=s.clone(this.data.trip)
    t.records[this.data.recordId]={note:this.data.note,photos:this.data.photos,done:true,at:new Date().toISOString()}
    s.updateTrip(t)
    setTitle(TITLE_HOME)
    this.setData({recordId:'',editItem:null,recordMeta:'',recordTitle:''})
    this.onShow()
  })},
  cancel(){setTitle(TITLE_HOME);this.setData({recordId:'',editItem:null,recordMeta:'',recordTitle:''})},
  async complete(){if(await u.confirm('结束旅程？','记录会保留，默认不公开。'))u.run(this,()=>{
    const t=s.clone(this.data.trip)
    t.status='completed'
    t.finishedAt=new Date().toISOString()
    s.updateTrip(t)
    this.onShow()
  })},
  async visibility(){
    if(!u.requireAccount(this,'行程公开'))return
    const t=s.clone(this.data.trip)
    if(t.visibility!=='public'&&!await u.confirm('开放行程？','将行程、评价及照片展示在本机社区预览；如需发布到云端社区，请使用社区发布入口。'))return
    u.run(this,()=>{
      t.visibility=t.visibility==='public'?'private':'public'
      s.updateTrip(t)
      this.onShow()
    })
  }
})
