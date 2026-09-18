// Curated, compact facts derived from public geographic knowledge and the prototype's
// 2025 historical trip. Historical services/prices are deliberately excluded because
// they are not live data and must not be presented as current.
const PLACES = Object.freeze({
  changchun: { name: '长春', fact: '东北区域铁路枢纽之一，适合作为进入林区前的城市换乘点。' },
  jinshantun: { name: '金山屯', fact: '位于伊春林区，金祖峰、金山鹿苑等游览点需要预留本地接驳时间。' },
  yichun: { name: '伊春', fact: '黑龙江林区城市，可作为前往周边林区节点的补给和住宿点。' },
  tangwanghe: { name: '汤旺河', fact: '位于伊春北部林区，前往石林等景点通常要考虑景区与城际接驳。' },
  harbin: { name: '哈尔滨', fact: '黑龙江省会和综合交通枢纽，适合安排补给、休整和中转。' },
  mohe: { name: '漠河', fact: '地处中国高纬度地区，前往北极村等周边目的地需额外安排往返接驳。' },
  mangui: { name: '满归', fact: '内蒙古大兴安岭林区小镇，跨区域公共交通选择相对有限。' },
  hailaer: { name: '海拉尔', fact: '呼伦贝尔主要城市交通节点，可作为草原方向游览的补给与住宿基地。' }
})

function contextFor(stops) {
  return stops.map(({ placeId }) => {
    const place = PLACES[placeId]
    return `- ${place.name}：${place.fact}`
  }).join('\n')
}

module.exports = { PLACES, contextFor }
