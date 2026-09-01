// 中国海洋大学近期新闻模拟数据
const news = [
  {
    id: 'ouc-20260827',
    title: '山东省人民政府副省长闫剑波来校调研',
    poster: '/images/newsimage1.jpg',
    category: '海大要闻',
    summary: '调研组参观学校校史馆、海洋科技成果展和海洋工程技术与装备展。',
    content: '8月27日，山东省人民政府副省长、党组成员闫剑波来中国海洋大学调研。学校党委书记李明陪同调研。\n\n闫剑波一行参观了学校校史馆、海洋科技成果展和海洋工程技术与装备展，听取学校百年发展历程与办学成就介绍，了解学校在海洋科技创新、成果转化和服务地方经济社会发展等方面取得的进展。',
    add_date: '2026-08-27'
  },
  {
    id: 'ouc-20260826',
    title: '中国海洋大学学子在全国大学生跆拳道锦标赛中再创佳绩',
    poster: '/images/newsimage2.jpg',
    category: '综合新闻',
    summary: '学校代表队奋勇拼搏，斩获2枚银牌、1枚铜牌。',
    content: '近日，第二十届中国大学生跆拳道锦标赛总决赛在南京落幕。中国海洋大学代表队经过多轮激烈角逐，最终斩获2枚银牌、1枚铜牌。\n\n参赛学生在赛场上不畏强手、敢打敢拼，展现了扎实的竞技水平和昂扬向上的精神风貌，为学校赢得了荣誉。',
    add_date: '2026-08-26'
  },
  {
    id: 'ouc-20260824',
    title: '中国海洋大学2026级研究生开学典礼举行',
    poster: '/images/newsimage3.jpg',
    category: '海大要闻',
    summary: '六千余名研究生新生齐聚海大园，开启求学新征程。',
    content: '8月24日，中国海洋大学2026级研究生开学典礼在崂山校区综合体育馆举行。学校领导、教师代表和2026级研究生新生共同参加典礼。\n\n来自五湖四海的新生怀揣蓝色梦想齐聚海大园。典礼勉励同学们坚定理想、潜心求学，在服务海洋强国建设的实践中增长本领、贡献青春力量。',
    add_date: '2026-08-24'
  },
  {
    id: 'ouc-20260823',
    title: '中国海洋大学2026级研究生入学报到',
    poster: '/images/newsimage1.jpg',
    category: '校园动态',
    summary: '校园迎来崭新朝气，新生在志愿者引导下顺利完成报到。',
    content: '8月23日，中国海洋大学2026级研究生新生迎新工作开展。新生们跨越五湖四海来到海大园，在工作人员和志愿者的引导下完成注册报到。\n\n学校领导来到迎新现场了解报到流程，看望新生并慰问参与迎新工作的师生员工。各单位通过细致服务帮助新生尽快熟悉校园、融入新的学习生活。',
    add_date: '2026-08-23'
  }
]

function getNewsList() {
  return news.map(function(item) {
    return {
      id: item.id,
      poster: item.poster,
      add_date: item.add_date,
      title: item.title,
      category: item.category,
      summary: item.summary
    }
  })
}

function getNewsDetail(newsID) {
  const article = news.find(function(item) {
    return item.id === newsID
  })

  return article
    ? { code: '200', news: article }
    : { code: '404', news: {} }
}

function getNewsByIds(ids) {
  return ids
    .map(function(id) {
      const result = getNewsDetail(id)
      return result.code === '200' ? result.news : null
    })
    .filter(function(item) {
      return item !== null
    })
}

module.exports = {
  getNewsList: getNewsList,
  getNewsDetail: getNewsDetail,
  getNewsByIds: getNewsByIds
}
