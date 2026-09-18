const store=require('./travel-store')
function friendlyError(error) {
  const raw=String(error&&error.message||error||'')
  const status=Number(error&&error.status||0)
  if(status===401)return '微信登录已过期，请重新登录后再试。'
  if(status===403)return '当前账号没有权限执行此操作。'
  if(status===404)return '内容已不可用或不存在，请返回后刷新。'
  if(status>=500)return '云端暂时没有响应，请稍后重试；已生成的方案可以继续查看。'
  if(/callContainer:fail|请求超时|network timeout|socket disconnected/i.test(raw))return '云端暂时没有响应，请稍后重试；已生成的方案可以继续查看。'
  if(/401|登录已过期|请先微信登录/i.test(raw))return '微信登录已过期，请重新登录后再试。'
  if(/403|无权限|不可用/i.test(raw))return '当前内容或操作不可用，请刷新后重试。'
  return raw||'操作未完成，请稍后重试。'
}
function fail(page,error) { page.setData({error:friendlyError(error)}); wx.showToast({title:'操作未完成，请查看提示',icon:'none'}) }
function run(page,fn) { try{return fn()}catch(e){fail(page,e)} }
function tab(name) { wx.switchTab({url:'/pages/'+name+'/'+name}) }
function open(name,query) { wx.navigateTo({url:'/pages/'+name+'/'+name+(query?'?'+query:'')}) }
function confirm(title,content) {return new Promise(resolve=>wx.showModal({title:content?title:'请确认',content:content||title,success:r=>resolve(r.confirm),fail:()=>resolve(false)}))}
function requireAccount(page, source) {
  if(store.session().kind==='guest'){
    const loginSource=store.recordLoginSource(source||'社区操作')
    page.setData({error:'请先到“我的”页微信登录；返回后请重新发起操作。',loginSource})
    try { if (typeof wx.switchTab === 'function') wx.switchTab({url:'/pages/me/me'}) } catch (_) {}
    return false
  }
  return true
}
function publicPlan(plan) {
  if(!plan)return null
  const stops = (plan.stops || []).map(p => {
    const next = { id: p.id, placeId: p.placeId || p.id, name: p.name }
    const fields = ['provider', 'providerId', 'providerKind', 'objectType', 'planningRole', 'category', 'categoryGroup', 'address', 'province', 'city', 'district', 'administrativeLevel', 'adminLevel', 'latitude', 'longitude', 'isCity', 'isProvince', 'isAdministrative']
    fields.forEach(key => { if (p[key] !== undefined && p[key] !== null) next[key] = p[key] })
    return next
  })
  return {items:(plan.items || []).map(i=>({id:i.id,type:i.type,title:i.title,date:i.date,start:i.start,end:i.end,endDate:i.endDate,variant:i.variant})),stops}
}
function posts() {
  const state=store.read(),user=store.session()
  const trips=state.trips.filter(t=>t.visibility==='public'&&t.status==='completed').map(t=>({
    id:t.id,authorId:user.id,authorName:user.nickname,type:'route',title:t.plan.stops.map(p=>p.name).join(' → ')+' · 已完成行程',
    content:Object.values(t.records).map(r=>r.note).filter(Boolean).join('\n')||'已完成旅行，欢迎参考。',
    placeNames:t.plan.stops.map(p=>p.name),plan:publicPlan(t.plan),places:publicPlan(t.plan).stops,photos:Object.values(t.records).reduce((a,r)=>a.concat(r.photos||[]),[]),
    visibility:'public',createdAt:t.finishedAt||t.startedAt,answers:[]
  }))
  return require('./travel-engine').seedPosts.concat(state.posts.filter(p=>p.visibility==='public'),trips).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
}
module.exports={fail,friendlyError,run,tab,open,confirm,requireAccount,posts,publicPlan}
