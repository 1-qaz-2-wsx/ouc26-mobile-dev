# OUC26夏移动软件开发-实验5

<center>姓名：马一诺　学号：24020007088</center>

| 项目 | 内容 |
| --- | --- |
| 姓名和学号 | 马一诺，24020007088 |
| 所属课程 | 中国海洋大学26夏《移动软件开发》 |
| 实验名称 | 实验5：HarmonyOS 多功能计算器 |
| 博客地址 | 待发布后补充 |
| 代码仓库地址 | https://github.com/1-qaz-2-wsx/ouc26-mobile-dev/tree/main/lab5/code5.0 |

## 一、实验内容

### 1. 实验目标与开发环境

本实验使用 HarmonyOS 的 ArkTS / ArkUI 声明式框架，参照华为开发者官方文档《计算器-关键场景示例》实现一个计算器应用，并在此基础上扩展为一个"多功能计算器"。除基础的普通计算器、科学计算器外，还新增了亲戚称呼换算、进制转换、单位换算和汇率换算共六个功能。

开发环境为 DevEco Studio，工程兼容 HarmonyOS SDK 6.1.1(24)，targetSdk 26.0.0。主要练习内容包括：

- 使用 ArkUI 的 `@Entry`、`@Component`、`@State`、`@StorageLink`、`@Builder`、`ForEach`、`bindMenu` 等构建声明式界面；
- 将表达式解析、亲戚关系、进制 / 单位 / 汇率换算等纯逻辑拆分为独立工具类；
- 使用 `router.replaceUrl` 实现同层级页面的切换，并通过统一的右上角菜单串联六个功能；
- 通过 `window` 全屏窗口和避让区（`topRectHeight` / `bottomRectHeight`）适配挖孔屏与导航条；
- 统一各页面的 iOS 风格胶囊按钮视觉。

> **截图位置 1：DevEco Studio 中的工程创建、目录结构和首页运行效果。**

### 2. 项目结构与六大功能页面

项目注册了六个同层级页面，每个页面左上角显示功能标题，右上角 ☰ 菜单可切换到其余功能：

| 页面 | 路径 | 主要功能 |
| --- | --- | --- |
| 普通计算器 | `pages/MainPage` | 四则运算、百分比、正负号、清除 / 删除 |
| 科学计算器 | `pages/ScientificPage` | 三角函数、对数、幂、括号、记忆、角度制切换 |
| 亲戚称呼换算 | `pages/RelationshipPage` | 三种查询模式、性别选择、关系链推演 |
| 进制转换 | `pages/BaseConverterPage` | 十六进制 / 十进制 / 八进制 / 二进制互转 |
| 单位换算 | `pages/UnitConverterPage` | 长度 / 重量 / 面积 / 体积 / 温度 / 速度 / 数据 |
| 汇率换算 | `pages/CurrencyConverterPage` | 8 种货币按静态汇率换算 |

主要目录如下：

```text
code5.0/
├─ AppScope/
├─ entry/src/main/
│  ├─ ets/
│  │  ├─ entryability/EntryAbility.ets   # 加载主页、全屏窗口、避让区
│  │  ├─ entrybackupability/
│  │  ├─ pages/                          # 六个功能页面
│  │  │  ├─ MainPage.ets                 # 普通计算器
│  │  │  ├─ ScientificPage.ets           # 科学计算器
│  │  │  ├─ RelationshipPage.ets         # 亲戚称呼换算
│  │  │  ├─ BaseConverterPage.ets        # 进制转换
│  │  │  ├─ UnitConverterPage.ets        # 单位换算
│  │  │  └─ CurrencyConverterPage.ets    # 汇率换算
│  │  ├─ common/
│  │  │  ├─ constants/CommonConstants.ets
│  │  │  └─ util/
│  │  │     ├─ CalculateUtil.ets         # 表达式解析与求值
│  │  │     ├─ KinshipUtil.ets           # 亲戚关系图引擎
│  │  │     ├─ BaseConverterUtil.ets     # 进制转换
│  │  │     ├─ UnitConverterUtil.ets     # 单位换算（仿射映射）
│  │  │     ├─ CurrencyConverterUtil.ets # 汇率换算（静态汇率表）
│  │  │     ├─ NavMenu.ets               # 统一功能菜单
│  │  │     ├─ CheckEmptyUtil.ets
│  │  │     └─ Logger.ets
│  │  └─ viewmodel/                      # 键盘按钮数据模型
│  │     ├─ PressKeysItem.ets / PresskeysViewModel.ets
│  │     ├─ ScientificKeyItem.ets / ScientificKeyViewModel.ets
│  │     └─ RelationshipKeyItem.ets / RelationshipKeyViewModel.ets
│  └─ resources/base/
│     ├─ element/                        # string.json / color.json / float.json
│     ├─ media/                          # 键盘与图标素材
│     └─ profile/main_pages.json         # 页面注册表
├─ build-profile.json5
└─ oh-package.json5
```

这种结构把界面渲染和业务逻辑分开：页面只负责交互和展示，`common/util` 下的工具类承载可复用的纯逻辑，便于测试与维护。

> **截图位置 2：六个功能页面对比图和项目目录结构。**

### 3. 全局配置与 iOS 风格主题

`main_pages.json` 注册了全部六个页面，`module.json5` 指定入口为 `EntryAbility`：

```json
{
  "src": [
    "pages/MainPage",
    "pages/ScientificPage",
    "pages/RelationshipPage",
    "pages/BaseConverterPage",
    "pages/UnitConverterPage",
    "pages/CurrencyConverterPage"
  ]
}
```

页面视觉统一为 iOS 计算器风格：浅灰背景 `#F2F2F7`，数字键白色，运算符 / 删除键 `#E5E5EA`，等号键橙色 `#FF9500`，切换 / 激活态使用系统蓝 `#007AFF`。所有按键使用大圆角（基础键 `borderRadius(40)`、函数键 `borderRadius(35)`）呈现胶囊形，且不添加阴影，靠颜色区分层级。配色在 `color.json` 中集中管理：

```json
{
  "color": [
    { "name": "all_back_color", "value": "#F2F2F7" },
    { "name": "equals_back_color", "value": "#007DFF" }
  ]
}
```

`EntryAbility.ets` 在 `onWindowStageCreate` 中加载 `pages/MainPage`，调用 `setWindowLayoutFullScreen(true)` 开启全屏，并通过 `getWindowAvoidArea` 获取状态栏和导航条的避让高度，写入 `AppStorage`（`topRectHeight` / `bottomRectHeight`），同时注册 `avoidAreaChange` 监听以在旋转或分屏时动态更新：

```typescript
windowStage.loadContent('pages/MainPage', (err) => { ... });

windowClass.setWindowLayoutFullScreen(true);
const avoidArea = windowClass.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
AppStorage.setOrCreate('topRectHeight', avoidArea.topRect.height);
```

> **截图位置 3：普通计算器首页的 iOS 风格按钮、浅灰背景和标题栏。**

### 4. 统一功能导航菜单

为避免六个页面各自维护一份菜单，项目新增 `common/util/NavMenu.ets`。`buildNavMenu(current)` 返回 `Array<MenuElement>`，其中当前页面所在项末尾加 `✓` 标记，点击其他项通过 `router.replaceUrl` 跳转：

```typescript
const ENTRIES: NavEntry[] = [
  { key: 'calculator', label: '普通计算器', url: 'pages/MainPage' },
  { key: 'scientific', label: '科学计算器', url: 'pages/ScientificPage' },
  { key: 'relationship', label: '亲戚称呼换算', url: 'pages/RelationshipPage' },
  { key: 'base', label: '进制转换', url: 'pages/BaseConverterPage' },
  { key: 'unit', label: '单位换算', url: 'pages/UnitConverterPage' },
  { key: 'currency', label: '汇率换算', url: 'pages/CurrencyConverterPage' }
];

export function buildNavMenu(current: string): Array<MenuElement> {
  const result: Array<MenuElement> = [];
  ENTRIES.forEach((entry: NavEntry) => {
    const label = entry.key === current ? `${entry.label}  ✓` : entry.label;
    result.push({
      value: label,
      action: (): void => {
        if (entry.key !== current) {
          router.replaceUrl({ url: entry.url });
        }
      }
    });
  });
  return result;
}
```

每个页面的标题栏右侧都调用 `bindMenu(buildNavMenu('当前功能'))`，实现"所有页面都显示全部功能、当前功能打勾"的统一交互。使用 `replaceUrl` 而非 `pushUrl`，保证页面栈始终为单层，六个页面处于同一层级、无父子返回关系。

> **截图位置 4：右上角 ☰ 菜单展开效果，当前功能前有 ✓ 标记。**

### 5. 普通计算器键盘与布局

普通计算器采用 4 列 × 5 行键盘，按键通过 `ForEach` 从 `PresskeysViewModel` 的数据集中生成，行列均使用 `layoutWeight(1)` 等分，使其自适应不同屏幕宽度。数字键白色、运算符和删除键浅灰、等号键橙色，与参考图保持一致。

输入处理沿用华为官方示例的状态模型：`expressions` 数组保存数字与运算符，`inputNumber` / `inputOperators` / `negateLast` 分别处理数字、符号和正负号，`getResult` 调用 `CalculateUtil.parseExpression` 求值。显示区采用固定高度并底部对齐，避免输入前后布局跳动。

> **截图位置 5：普通计算器的 4×5 键盘布局和运算示例。**

### 6. 科学计算器键盘与状态机

科学计算器在基础键盘之上增加 6 列 × 4 行函数区，包含括号、记忆键（MC / M+ / M- / MR）、阶乘 / 平方 / 立方 / 幂、π / e、`1/x` / `√` / `∛` / `ʸ√`、`Inv`、角度制切换（Rad / Deg）以及 `e` / `ln` / `lg` / `sin` / `cos` / `tan`。

其输入状态机包含以下核心状态：

- `tokens`：已提交的数字、运算符、括号和函数名的扁平序列；
- `currentNum`：正在输入的数字；
- `pendingOp` / `pendingOperand`：`x^y` 与 `ʸ√x` 两步式运算的暂存；
- `memoryValue`：记忆值；
- `justApplied`：函数 / 常量 / 百分比结果后，下一次输入数字开启新数。

函数键有两种行为：当前已有数字时立即对单个数求值（如输入 `30` 后点 `sin`）；否则以"函数 + 左括号"形式进入待输入状态，使参数可以是完整的子表达式（如 `sin(π/2)`）。角度制切换会把 `angleMode` 传给求值函数，三角函数与反三角函数据此做弧度 / 角度换算。

> **截图位置 6：科学计算器的函数区 + 基础区键盘，以及 Rad/Deg 状态。**

### 7. 表达式解析器（调度场算法 + 函数 + 一元负号）

科学计算器的核心是 `common/util/CalculateUtil.ets`。它先对 `%` 后缀和末尾多余运算符做预处理，再用调度场算法（shunting-yard）把中缀表达式转为后缀队列，最后求值：

```typescript
static readonly FUNCTIONS: string[] = [
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'ln', 'log', 'exp', 'pow10', 'sqrt', 'cbrt',
  'abs', 'square', 'cube', 'fact', 'inv', 'neg'
];

parseExpression(expressions: Array<string>, angleMode?: string): string {
  // '(' 入栈；')' 弹栈直到 '('，并在 '(' 下方紧邻函数时把函数一起弹到输出队列；
  // 函数名入栈；运算符按优先级弹栈；数字直接进输出队列；
  // 最后返回 dealQueue(outputQueue, angleMode)。
}
```

`dealQueue` 求值时，遇函数名弹出一个操作数调用 `applyFunction`，遇二元运算符弹出两个操作数调用 `calResult`。`applyFunction` 支持三角 / 反三角、对数、幂、开方、阶乘等运算，并根据 `angleMode` 做角度换算：

```typescript
case 'sin': r = Math.sin(useDeg ? n * Math.PI / 180 : n); break;
case 'asin': r = useDeg ? Math.asin(n) * 180 / Math.PI : Math.asin(n); break;
```

针对浮点运算噪声（例如 `tan(π/4)` 得到 `0.9999999999999983` 而非 `1`），`applyFunction` 与 `applyPow` 在返回前用 `roundSignificant(value, 12)` 按 12 位有效数字舍入，得到 `1`、`-1` 等干净结果。

负数的处理统一为"带符号的数字 token"：`-` 键在表达式开头、`(` 之后或运算符之后被识别为一元负号，进入 `currentNum = '-'` 状态，后续数字拼接成 `-3`，因此 `(-3)*(-4)` 可正确得到 `12`，`sqrt(-4)` 会得到 `NaN` 并显示错误。

> **截图位置 7：科学计算器 `sin(π/2)`、`(-3)*(-4)`、`sqrt(-4)` 等运算结果。**

### 8. 亲戚称呼换算（关系图引擎）

亲戚称呼换算通过 `common/util/KinshipUtil.ets` 实现，提供三种查询模式：

1. **查询亲戚的称呼**：按"爸爸 / 妈妈 / 老公 / 老婆 / 儿子 / 女儿 / 哥哥 / 弟弟 / 姐姐 / 妹妹"十个关系键依次推演，输出对应的中文称呼；
2. **查询亲戚对我的称呼**：同一关系链反向映射，输出对方对我的称呼；
3. **根据称呼查询关系**：通过 `TITLE_TO_RELATION` 映射表，由称呼反查关系描述。

关系链用一个 `KinshipNode`（代际 `gen`、性别 `gender`、亲系 `side`、长幼 `birthOrder`、类别 `category`）表示。每个关系 token 根据当前节点类别按中式亲属规则转移，例如"爸爸的哥哥"得到类别 `parentSibling`、长幼 `elder`，最终映射为"伯父"：

```typescript
if (node.gen === 1 && node.category === 'parentSibling') {
  if (node.side === 'paternal' && node.gender === 'M' && node.birthOrder === 'elder') return '伯父';
  if (node.side === 'paternal' && node.gender === 'M' && node.birthOrder === 'younger') return '叔叔';
  // ...
}
```

性别默认选择"女"，且女性称呼排在男性称呼之前。为避免"爸爸的老公"这类非法输入显示"—"后无法继续，`tryAppendToken` 会先试算追加 token 后的关系链，只有结果合法才返回新链，否则静默丢弃本次点击，保留原链并允许继续输入其他有效关系。

> **截图位置 8：亲戚称呼换算三种查询模式、性别选择和关系链推演结果。**

### 9. 进制转换

进制转换页提供十六进制（HEX）、十进制（DEC）、八进制（OCT）、二进制（BIN）四个进制。`BaseConverterUtil` 负责任意进制互转，先转十进制再转目标进制，并校验每个数字在当前进制下是否合法：

```typescript
static toDecimal(input: string, fromBase: number): string {
  let value = 0;
  for (let i = 0; i < input.length; i++) {
    const index = BaseConverterUtil.BASE_DIGITS.indexOf(input[i].toUpperCase());
    if (index < 0 || index >= fromBase) return '';
    value = value * fromBase + index;
  }
  return value.toString();
}

static fromDecimal(decimal: string, toBase: number): string {
  let num = Number(decimal);
  let result = '';
  while (num > 0) {
    result = BaseConverterUtil.BASE_DIGITS.charAt(num % toBase) + result;
    num = Math.floor(num / toBase);
  }
  return result;
}
```

页面上方是 HEX / DEC / OCT / BIN 的切换胶囊，中间显示当前输入及四种进制的同步换算结果，下方是十六进制数字键盘。切换进制时会按当前输入重新解释并转换，非法数字在当前进制下以灰色置灰不可点。

> **截图位置 9：进制转换页面的四进制切换与同步换算结果。**

### 10. 单位换算

单位换算支持长度、重量、面积、体积、温度、速度、数据七类。`UnitConverterUtil` 用"基准单位 + 仿射映射"统一描述：`baseValue = value * factor + offset`，因此温度这类带偏移量的换算也能正确处理：

```typescript
export class UnitDef {
  label: string;
  factor: number;
  offset: number;
}

// 温度：摄氏度 / 华氏度 / 开尔文
new UnitDef('摄氏度', 1, 0),
new UnitDef('华氏度', 5 / 9, -160 / 9),
new UnitDef('开尔文', 1, -273.15)
```

`convert(value, from, to)` 先把输入换算到基准单位，再从基准单位换算到目标单位。页面上方是分类横向滚动条，中间选择"从 / 到"单位，结果显示实时换算值。

> **截图位置 10：单位换算的分类切换、单位选择和换算结果。**

### 11. 汇率换算

汇率换算内置人民币、美元、欧元、日元、英镑、港币、韩元、澳元 8 种货币，`CurrencyConverterUtil` 维护一张以人民币为基准的静态汇率表：

```typescript
static getCurrencies(): CurrencyDef[] {
  return [
    new CurrencyDef('CNY', '人民币', 1),
    new CurrencyDef('USD', '美元', 7.20),
    new CurrencyDef('EUR', '欧元', 7.80),
    // ...
  ];
}

static convert(value: number, from: CurrencyDef, to: CurrencyDef): number {
  return value * from.rate / to.rate;
}
```

页面上方选择"从 / 到"货币，下方显示换算结果，并标注"汇率仅供参考（静态）"。真实应用中可替换为动态汇率接口。

> **截图位置 11：汇率换算的货币选择与换算结果。**

### 12. 全屏窗口与屏幕适配

为避免界面被状态栏、导航条遮挡，`EntryAbility` 开启全屏窗口并把避让区高度写入 `AppStorage`，每个页面用 `@StorageLink` 读取，通过 `.margin({ top: px2vp(topRectHeight) })` 和底部 `px2vp(bottomRectHeight)` 留白。

键盘区域使用 `layoutWeight(1)` 的行高自适应和列等分，显示区使用固定高度 + 底部对齐，保证在不同尺寸的手机上既不会溢出，也不会因为输入前后内容变化而跳动。六个页面共享同一套配色、字体族、胶囊圆角和间距约定，视觉风格一致。

> **截图位置 12：不同屏幕尺寸 / 挖孔屏下的全屏避让与键盘自适应效果。**

## 二、问题总结与体会

### 1. 实验中遇到的问题及解决方法

（1）**ArkTS 严格类型的限制。** 静态方法内使用 `this` 会报 `arkts-no-standalone-this`，匿名对象字面量作为默认导出会报 `arkts-no-untyped-obj-literals`。解决方法是将工具类改为显式 `export class` 并用类名访问静态成员（`BaseConverterUtil.BASE_DIGITS`），对象字面量显式标注类型。

（2）**页面跳转不生效。** 最初 `router.pushUrl` 跳转亲戚称呼页无响应，原因是目标页必须注册在 `main_pages.json` 且标注 `@Entry`。解决方法是为每个页面加 `@Entry` 并写入注册表，同时改用 `router.replaceUrl` 保持单层页面栈。

（3）**`ForEach` 键生成器索引变量报错。** `ForEach` 的 keyGenerator 是独立函数，拿不到 itemBuilder 形参里的 `colIndex` / `rowIndex`，报 `Cannot find name`。解决方法是给 keyGenerator 自己补上索引形参，如 `(digit, colIndex) => \`digit_${rowIndex}_${colIndex}\``。

（4）**`bindMenu` 类型用错。** 早期使用 `MenuItem` 组件作为菜单项，ArkUI 的 `bindMenu` 实际需要 `MenuElement` 接口。解决方法是把菜单类型统一改为 `Array<MenuElement>`。

（5）**科学计算器函数无法接收子表达式。** 最初的函数前缀 `pendingFunc` 只能吃单个数字，导致 `sin(π/2)`、`ln(e)` 等输入不了常量或表达式。解决方法是把函数重构为一等 token（函数名 + `(`），并扩展调度场算法支持函数与一元负号，使参数可以是完整子表达式。

（6）**浮点噪声导致结果不干净。** `tan(π/4)` 会得到 `0.9999999999999983`。解决方法是在函数与幂运算返回前按 12 位有效数字舍入，得到 `1`、`-1` 等期望结果。

（7）**点右括号像点等号。** 闭合括号后 `updatePreview` 立即显示最终结果，使 `)` 与 `=` 视觉上无差别。解决方法是闭合括号后清空预览，只有 `=` 才真正求值。

（8）**亲戚页排版错乱。** 亲戚页最初没有做全屏避让，顶栏与状态栏重叠、键盘被导航条压住。解决方法是为页面加 `@StorageLink` 避让区并扁平化布局，统一键盘与计算器的风格。

（9）**非法关系输入影响后续操作。** 输入"爸爸的老公"会显示"—"且无法继续。解决方法是用 `tryAppendToken` 试算 token 追加是否合法，非法时静默忽略并保留原链。

### 2. 实验收获与体会

通过本次实验，我把华为官方的基础计算器示例扩展为一个包含六个功能的"多功能计算器"，对 HarmonyOS 的 ArkTS / ArkUI 声明式开发有了从页面搭建、状态管理到路由跳转、全屏适配的系统认识。

在声明式 UI 方面，`@State`、`@StorageLink`、`@Builder` 和 `ForEach` 的组合让界面由数据驱动，配合 `bindMenu` 和统一的菜单工具类，六个页面得以共享一套视觉与交互规范，避免重复代码。

在算法方面，科学计算器的核心是表达式解析。通过调度场算法处理括号优先级、函数和一员负号，我理解了中缀表达式转后缀求值的完整流程；同时认识到浮点运算会带来可见噪声，需要用有效数字舍入来修正结果，让计算器输出符合直觉。

在软件结构方面，把表达式解析、亲戚关系推演、进制 / 单位 / 汇率换算等纯逻辑拆分为独立工具类，页面只负责交互，代码更清晰、更易测试和维护。

在工程约束方面，ArkTS 的严格类型、`main_pages.json` 注册与 `@Entry` 的关系、`ForEach` 键生成器的作用域等细节，都需要在开发中反复确认。通过这些踩坑与修正，我对 HarmonyOS 应用的构建约束和真机适配有了更扎实的掌握，也为后续更复杂的功能打下了基础。
