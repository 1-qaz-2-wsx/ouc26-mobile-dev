# OUC26夏移动软件开发-实验3

<center>姓名：马一诺　学号：24020007088</center>

| 项目 | 内容 |
| --- | --- |
| 姓名和学号 | 马一诺，24020007088 |
| 所属课程 | 中国海洋大学26夏《移动软件开发》 |
| 实验名称 | 实验3：高校新闻网 |
| 博客地址 | https://blog.csdn.net/2604_96828618/article/details/164222140?spm=1011.2415.3001.10575&sharefrom=mp_manage_link |
| 代码仓库地址 | https://github.com/1-qaz-2-wsx/ouc26-mobile-dev/tree/main/lab3/code3 |

## 一、实验内容

### 1. 实验目标与开发环境

本实验根据[课程网页](https://oucai.club/classes/Mobile/lab03)和[实验手册](https://gaopursuit.oss-cn-beijing.aliyuncs.com/course/mobileDev/lab3.pdf)，使用微信小程序原生框架开发一个以中国海洋大学为主题的高校新闻网。项目使用本地模拟新闻数据和微信本地缓存，不接入云开发、服务器或数据库。

在完成轮播图、新闻列表、详情展示、用户登录和新闻收藏等基本要求的基础上，本项目进一步实现了搜索与分类、阅读历史、批量收藏管理、新闻分享、深浅色主题和正文字号设置等功能，主要练习内容包括：

- 使用 WXML、WXSS 和 JavaScript 构建多页面小程序；
- 使用 `app.json` 配置页面、导航栏和 `tabBar`；
- 使用公共模块管理新闻数据和本地状态；
- 使用生命周期函数完成跨页面数据刷新；
- 使用微信原生头像选择、登录、分享及本地缓存 API；
- 处理登录权限、重复操作和跨页面状态同步。

<!-- TODO：插入微信开发者工具中的项目创建及目录结构截图 -->
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/d612b849a4134b11be610eebebdabe17.png)

### 2. 项目结构与页面功能

当前小程序共注册六个页面，其中首页和个人中心是 `tabBar` 页面，其余页面通过 `navigateTo` 或 `redirectTo` 打开。

| 页面 | 路径 | 主要功能 |
| --- | --- | --- |
| 首页 | `pages/index/index` | 轮播图、新闻列表、搜索、分类、收藏、分享和已读标记 |
| 新闻详情 | `pages/detail/detail` | 新闻全文、收藏、分享、复制标题、字号调整和相关推荐 |
| 个人中心 | `pages/my/my` | 微信头像登录、资料修改、退出登录和收藏批量管理 |
| 新闻合集 | `pages/collection/collection` | 展示并分享批量选择的新闻 |
| 阅读历史 | `pages/history/history` | 查看最近阅读记录并一键清空 |
| 设置 | `pages/settings/settings` | 主题、字号、缓存信息及本地数据清理 |

主要目录如下：

```text
code3/
├─ app.js / app.json / app.wxss
├─ images/                  # tabBar 图标和本地新闻图片
├─ utils/
│  ├─ common.js             # 公共新闻数据与查询函数
│  └─ store.js              # 登录、收藏、历史和设置服务
└─ pages/
   ├─ index/                # 首页
   ├─ detail/               # 新闻详情
   ├─ my/                   # 个人中心
   ├─ collection/           # 新闻合集
   ├─ history/              # 阅读历史
   └─ settings/             # 设置
```

<!-- TODO：插入六个页面的整体效果对比图 -->
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/ee3408f797fd469b991697be1ca6dc66.png)
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/5056d7f1af0249f684cba1756b2c31e6.png)
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/7a8ded9200574563bfb60ec1a3b3a390.png)
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/c0a8fe783438460ebd88e32cd79b9412.png)
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/2a2dbbe4635a442f9dad5a8cb75729a2.png)
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/5f5e5c59c5fa4bb7be3940d8bb02355d.png)

### 3. 全局配置与海洋主题导航

`app.json` 的 `pages` 数组用于注册页面，数组第一项是小程序启动页：

```json
"pages": [
  "pages/index/index",
  "pages/detail/detail",
  "pages/my/my",
  "pages/collection/collection",
  "pages/history/history",
  "pages/settings/settings"
]
```

全局导航栏以海洋蓝 `#005a9c` 为背景，标题为“海大新闻网”。底部 `tabBar` 提供首页和个人中心两个主要入口：

```json
"tabBar": {
  "color": "#64748b",
  "selectedColor": "#005a9c",
  "backgroundColor": "#ffffff",
  "list": [
    {
      "pagePath": "pages/index/index",
      "text": "首页",
      "iconPath": "images/index.png",
      "selectedIconPath": "images/index_blue.png"
    },
    {
      "pagePath": "pages/my/my",
      "text": "我的",
      "iconPath": "images/my.png",
      "selectedIconPath": "images/my_blue.png"
    }
  ]
}
```

`iconPath` 表示未选中图标，`selectedIconPath` 表示选中图标。普通页面使用 `wx.navigateTo()` 打开，而跳转到 `tabBar` 页面时使用 `wx.switchTab()`。
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/bfa369ec86cf48788fe516ba2c793293.png)




### 4. 公共新闻数据设计

新闻数据统一保存在 `utils/common.js` 的 `news` 数组中。每条新闻包含唯一 ID、标题、海报、分类、摘要、正文和日期：

```javascript
const news = [
  {
    id: 'ouc-20260827',
    title: '山东省人民政府副省长闫剑波来校调研',
    poster: '/images/newsimage1.jpg',
    category: '海大要闻',
    summary: '调研组参观学校校史馆、海洋科技成果展……',
    content: '8月27日，山东省人民政府副省长……',
    add_date: '2026-08-27'
  }
]
```

公共模块提供三个查询函数：

```javascript
getNewsList()          // 返回首页使用的新闻列表
getNewsDetail(newsID) // 根据唯一 ID 返回完整新闻
getNewsByIds(ids)     // 根据 ID 数组恢复收藏或合集
```

虽然已经存在 `news` 数组，仍然需要 `getNewsList()`。原因是页面不应该直接依赖模块内部数组：查询函数可以只返回首页需要的字段，并通过 `map()` 生成新对象，避免页面意外修改原始数据。以后将本地数组替换为接口数据时，也只需要调整公共模块。

各页面通过 CommonJS 引入数据模块：

```javascript
const common = require('../../utils/common.js')
```

这样首页、详情、个人中心、阅读历史和新闻合集都通过同一个新闻 ID 获取数据，避免多个页面分别维护新闻造成内容不一致。

### 5. 本地状态服务设计

为了避免每个页面重复调用缓存 API，项目新增 `utils/store.js`，集中处理用户会话、收藏、历史和设置。固定缓存键如下：

```javascript
const KEYS = {
  session: 'oucUserSession',
  favorites: 'favoriteNewsIds',
  history: 'readingHistory',
  settings: 'oucAppSettings'
}
```

其中：

- `oucUserSession` 保存仿真用户 ID、头像、昵称、登录时间和登录状态；
- `favoriteNewsIds` 保存收藏新闻的 ID 数组；
- `readingHistory` 保存新闻 ID 和最近阅读时间；
- `oucAppSettings` 保存主题与正文字号。

收藏数组通过 `Set` 去重，避免快速点击产生重复 ID：

```javascript
function uniqueIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).filter(Boolean)))
}
```

使用统一服务后，首页、详情页和个人中心不会分别编写缓存逻辑，收藏状态更容易保持同步。

### 6. 首页设计与功能实现

#### 6.1 标题区域与自动轮播图

首页顶部使用多个 `text` 标签显示英文标识、主标题和说明文字，并通过渐变背景形成统一的海洋主题。轮播区域使用 `swiper` 和 `swiper-item`：

```wxml
<swiper indicator-dots autoplay circular
  interval="5000" duration="500">
  <swiper-item wx:for="{{swiperImg}}" wx:key="src">
    <image src="{{item.src}}" mode="aspectFill"></image>
    <view class="swiper-mask"></view>
    <text class="swiper-title">{{item.title}}</text>
  </swiper-item>
</swiper>
```

- `indicator-dots` 显示轮播指示点；
- `autoplay` 开启自动播放；
- `circular` 让最后一张与第一张循环连接；
- `interval` 和 `duration` 分别控制停留时间与动画时长；
- `mode="aspectFill"` 保持图片比例并填满固定区域。

图片全部使用项目内 `/images` 路径，不依赖网络图片域名白名单。


![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/18fb44ad410944dca19f49c74db0d69f.png)
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/ebc2c729627f4094a728364fca869048.png)
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/04aee28edc684264ab1a910174b8aa7d.png)


#### 6.2 搜索与分类组合筛选

搜索框通过 `bindinput` 实时保存关键词，分类栏使用横向 `scroll-view` 展示“全部、海大要闻、综合新闻、校园动态”。`applyFilters()` 同时判断分类与关键词：

```javascript
const list = this.data.allNews.filter(item => {
  const categoryMatched = category === '全部' || item.category === category
  const text = `${item.title}${item.summary}`.toLowerCase()
  return categoryMatched && (!keyword || text.includes(keyword))
})
```

标题和摘要任意一处包含关键词即可匹配；搜索与分类条件同时生效。没有结果时使用 `wx:else` 显示统一空状态。

![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/fc12d6890fb441e8bbac3471b387cc8d.png)


#### 6.3 新闻列表、已读状态和快捷操作

新闻列表使用 `wx:for` 渲染，每一项通过 `data-id` 保存新闻 ID：

```wxml
<view class="news-item {{item.isRead ? 'news-read' : ''}}"
  wx:for="{{newsList}}" wx:key="id"
  bindtap="goToDetail" data-id="{{item.id}}">
  <image src="{{item.poster}}" mode="aspectFill"></image>
  <text>{{item.title}}</text>
  <text catchtap="toggleFavorite" data-id="{{item.id}}">
    {{item.isFavorite ? '♥' : '♡'}}
  </text>
</view>
```

`bindtap` 负责打开详情，红心使用 `catchtap` 阻止事件继续冒泡，避免点击收藏时同时跳转详情。每条新闻还提供“···”操作菜单，可分享新闻、收藏或取消收藏、标记已读或未读。页面的 `onShow()` 和下拉刷新都会重新加载收藏及已读状态。

<!-- TODO：插入新闻列表、红心和底部操作菜单截图 -->
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/3fa03b7fa07249e3a2d64bd4416fc9a9.png)

### 7. 新闻详情页设计

#### 7.1 根据 ID 查询新闻

首页只在 URL 中传递新闻 ID，详情页在 `onLoad(options)` 中查询完整数据：

```javascript
const result = common.getNewsDetail(options.id)
if (result.code !== '200') {
  this.setData({ notFound: true })
  return
}
this.setData({ article: result.news })
```

页面通过数据绑定显示分类、标题、日期、图片、摘要和正文。海报使用 `mode="widthFix"`，高度根据原始比例计算；正文保留段落换行。新闻不存在时显示异常空状态。

#### 7.2 阅读历史、相关推荐和底部工具栏

打开详情时调用 `recordHistory(id)` 保存阅读时间。同一新闻会先删除旧记录再插入数组开头，因此历史列表中只保留一条，并反映最近阅读时间。

详情页末尾展示两条相关推荐，底部固定工具栏提供：

- 收藏或取消收藏；
- 使用 `button open-type="share"` 分享给好友；
- 使用 `wx.setClipboardData()` 复制新闻标题；
- 循环切换小、中、大三档正文字号。

![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/bee61e83a84f4f99a2e23316ab020e40.png)
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/710a6d33b81542be83f1726a66f5f10f.png)


### 8. 微信仿真登录与个人资料

#### 8.1 登录方案说明

微信现行基础库已经不能通过旧的 `wx.getUserProfile()` 一次性获得真实微信头像和昵称。开启云开发只能通过登录凭证换取 `openid`，也不能绕过用户操作直接读取头像昵称。因此本实验使用课程演示级纯前端仿真登录：

1. 登录按钮本身设置 `open-type="chooseAvatar"`；
2. 用户点击后由微信打开原生头像选择界面；
3. 获取用户选择的头像后调用 `wx.saveFile()`保存本地文件；
4. 调用 `wx.login()`连接微信环境；
5. 登录成功后生成“海大读者 + 四位数字”的随机昵称；
6. 将会话保存到 `oucUserSession`。

```wxml
<button open-type="chooseAvatar"
  bindtap="beginAvatarChoice"
  bindchooseavatar="onLoginAvatarChosen"
  disabled="{{isLogging || isChoosingAvatar}}">
  微信头像登录
</button>
```

```javascript
connectWechat(avatarUrl) {
  wx.login({
    success: loginRes => {
      if (!loginRes.code) return
      this.finishLogin({
        nickName: store.generateRandomNickname(),
        avatarUrl
      }, loginRes.code)
    }
  })
}
```

该登录仅表示成功连接微信小程序运行环境，不保存临时 `code`，也不伪造 `openid`，不能用于跨设备识别同一个真实微信账号。

#### 8.2 防止头像选择重复触发

调试时曾出现 `chooseAvatar:fail another chooseAvatar is in progress`。原因是第一次原生头像选择尚未结束时，按钮又被重复触发。项目增加共享状态 `isChoosingAvatar`：首次点击后立即禁用登录和修改头像两个入口，选择完成后解除；如果开发者工具没有回调，则在 5 秒后自动恢复，并在页面卸载时清理定时器。

#### 8.3 资料修改与退出登录

登录后显示头像、随机昵称、仿真用户 ID 和登录时间。“资料与账号”区域提供修改头像、修改昵称和退出登录：

- 修改头像继续使用微信原生 `chooseAvatar`；
- 修改昵称使用 `input type="nickname"`，既可手动填写，也可使用微信提供的昵称快捷输入；
- 退出登录前通过 `wx.showModal()`确认，只删除 `oucUserSession`；
- 收藏、阅读历史和设置在退出后继续保留。

<!-- TODO：插入微信原生头像选择、登录结果和资料修改截图 -->
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/256138719149414da4e5ed530cad4189.png)


### 9. 登录权限与收藏同步

首页红心、首页操作菜单和详情页工具栏都能操作收藏。为避免未登录用户收藏，项目使用页面校验与服务校验两层保护。

页面在执行收藏前调用：

```javascript
if (!store.requireLogin()) return
```

未登录时显示“请先登录”对话框，用户可以跳转个人中心。收藏服务也会再次检查会话：

```javascript
function toggleFavorite(id) {
  if (!getSession()) return null
  // 登录后才允许修改 favoriteNewsIds
}
```

这样即使以后新增页面遗漏了界面判断，底层服务也不会写入收藏。退出登录后原收藏仍保存在本地，但首页红心显示为空且无法修改；重新登录后恢复原收藏状态。

收藏状态同步主要依靠两个设计：

- 所有页面统一调用 `store.toggleFavorite()`和 `store.isFavorite()`；
- 页面在 `onShow()` 中重新读取缓存，从详情页或个人中心返回后立即得到最新状态。

<!-- TODO：插入未登录收藏拦截提示及登录后红心状态截图 -->
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/48d95e7a33c04872b1f7e36d70616059.png)

### 10. 收藏批量管理与新闻合集分享

个人中心读取 `favoriteNewsIds`，再通过 `getNewsByIds(ids)`恢复新闻对象。点击“管理”后，列表进入批量选择状态：

- 点击复选框逐条选择；
- 支持全选与取消全选；
- 批量取消收藏前显示新闻数量并再次确认；
- 点击单条新闻右侧实心红心可快速取消；
- 未选择新闻时禁用“分享合集”。

分享合集时将新闻 ID 使用逗号连接并编码到页面参数中：

```javascript
const ids = encodeURIComponent(this.data.selectedIds.join(','))
const path = '/pages/collection/collection?ids=' + ids
```

合集页解析 ID 后展示对应新闻，并通过 `onShareAppMessage()`生成一张可打开多条新闻的分享卡片。

<!-- TODO：插入收藏批量管理和新闻合集页面截图 -->
![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/cd5c93c80458466980f86a2e617175e2.png)


### 11. 阅读历史与设置功能

阅读历史以如下结构保存：

```javascript
[
  { id: 'ouc-20260827', readAt: 1788160000000 }
]
```

历史页面根据 ID 恢复新闻标题、图片和分类，同时使用 `formatTime()`显示最近阅读时间，并提供一键清空功能。

设置页面提供：

- 浅色、深色和跟随系统三种主题；
- 小、中、大三档正文字号；
- 清除阅读历史；
- 清除全部收藏；
- 显示应用版本和本地存储占用。

主题和字号保存在 `oucAppSettings`。`applyAppearance()`除了切换页面类名，还调用 `wx.setNavigationBarColor()`和 `wx.setTabBarStyle()`，使导航栏、底部栏与页面主题保持一致。

![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/d1d1900780e042c2bc063174d77afa8e.png)


### 12. 界面风格与移动端适配

项目以海洋蓝 `#005a9c`、青蓝 `#0086b8`、浅灰蓝 `#f3f7fb` 和白色为主色。页面通过渐变标题区、圆角卡片、胶囊分类标签、弱化日期和统一空状态形成一致的视觉语言。

布局主要使用 `flex`，尺寸使用 `rpx`，使界面随屏幕宽度自动缩放。列表图片使用固定宽高配合 `aspectFill` 保持版式稳定；详情图片使用 `widthFix`保留完整比例。底部工具栏和批量操作栏使用安全区变量，减少全面屏设备底部遮挡。

### 13. 最终运行效果与测试

开发过程中使用模拟微信 API 对核心逻辑进行测试，并检查全部 JavaScript、JSON、WXML 和 WXSS 结构。主要验证结果如下：

- 原生头像选择后能够调用 `wx.login()`并创建会话；
- 随机昵称符合“海大读者 + 四位数字”的格式；
- 重复点击头像选择按钮不会再次发起操作；
- 修改头像或昵称不会改变用户 ID、收藏、历史和设置；
- 未登录时首页和详情页均无法修改收藏；
- 退出登录后收藏、历史和设置继续保留；
- 登录后首页、详情页和个人中心收藏状态保持同步；
- 搜索、分类、下拉刷新、阅读历史、主题和字号设置可正常使用。

微信原生头像选择、昵称快捷输入和分享面板需要在微信开发者工具及真机中进行最终人工验证。


## 二、问题总结与体会

### 1. 实验中遇到的问题及解决方法

（1）**旧版微信头像昵称授权方式已经失效。** 最初使用 `wx.getUserProfile()`，但当前基础库不能再通过一次授权获取测试者的真实头像昵称，并且失败回调曾把所有错误都提示成“用户取消授权”。解决方法是移除该接口，使用微信现行的 `button open-type="chooseAvatar"`，用户选择头像后完成仿真登录，并生成随机昵称。真实 `openid` 必须通过云函数或 HTTPS 后端使用登录凭证换取，但云开发同样不能直接读取真实头像昵称。

（2）**头像选择可能被重复触发。** 在 Windows 开发者工具中快速点击时出现 `another chooseAvatar is in progress`。解决方法是增加 `isChoosingAvatar` 共享锁，在选择期间禁用登录和修改头像入口，并设置超时恢复和页面卸载清理，防止重复调用或按钮永久锁定。

（3）**未登录状态仍然能够收藏。** 最初首页和详情页直接调用收藏服务，没有检查会话。解决方法是在所有收藏入口调用 `requireLogin()`，同时在 `toggleFavorite()`和 `removeFavorites()`底层再次校验。未登录操作不会改变本地收藏数组，并提供跳转个人中心的提示。

（4）**多个页面的收藏状态容易不一致。** 如果各页面分别维护布尔值，从详情页返回后首页红心可能仍是旧状态。解决方法是统一使用 `favoriteNewsIds`，并在页面 `onShow()` 中重新读取缓存；公共服务还通过 `Set` 去重，防止快速点击产生重复 ID。

（5）**收藏批量分享不能直接传递完整对象。** URL 参数不适合携带多个复杂新闻对象。解决方法是只传递编码后的 ID 字符串，合集页再调用 `getNewsByIds()`恢复新闻，实现一张卡片分享多条新闻。

（6）**网络图片在真机中可能无法显示。** 外部图片需要配置合法域名，也可能因网络波动失效，因此轮播图和新闻海报统一使用 `/images` 下的本地图片。

（7）**图片比例不同会造成变形。** 列表和轮播图使用固定容器与 `aspectFill`，详情大图使用 `widthFix`。针对不同展示场景选择图片模式，兼顾版式稳定和内容完整。

（8）**本机截图路径不能用于 CSDN。** Typora 自动生成的 `C:\Users\...` 路径只在本机有效，上传博客后无法显示。因此报告中不再保留绝对路径，截图位置统一使用 TODO 注释；发布到 CSDN 时应上传图片并使用平台生成的网络地址。

### 2. 实验收获与体会

通过本次实验，我完成了一个包含六个页面、公共数据、本地状态和用户交互的微信小程序，对小程序从配置、布局、数据组织到状态持久化的完整开发流程有了更系统的认识。

在页面开发方面，我进一步熟悉了 `swiper`、`scroll-view`、`image`、`button` 和 `input` 等组件，以及 `wx:for`、`wx:if`、数据绑定、事件绑定与事件冒泡。通过 `catchtap` 处理红心按钮，也理解了复杂列表中父子点击事件之间的关系。

在数据设计方面，我认识到公共数据数组和查询函数承担不同职责。将新闻数据封装在 `common.js`，将会话、收藏、历史和设置封装在 `store.js`，可以减少页面重复代码，并为跨页面同步和后续替换真实接口提供清晰边界。

在生命周期方面，`onLoad()`适合首次接收页面参数，`onShow()`适合每次页面重新显示时刷新共享状态。收藏红心、个人中心数量和历史记录的同步，使我体会到页面显示正确不仅取决于当前点击事件，还取决于返回页面时是否重新读取真实数据源。

在微信能力方面，我了解到小程序接口会随隐私政策和基础库版本发生变化。不能继续照搬旧教程中的 `wx.getUserProfile()`，而应该根据现行能力选择 `chooseAvatar`、`input type="nickname"` 和 `wx.login()`，并明确区分“前端仿真登录”“微信环境连接”和“服务端真实身份识别”。

在工程质量方面，登录权限漏洞和头像选择重入错误说明，仅实现正常流程还不够，还需要考虑未登录、取消、重复点击、接口失败和跨页面返回等边界情况。通过统一校验、状态锁、确认弹窗和模拟 API 测试，程序的交互完整性和稳定性得到明显提升。

