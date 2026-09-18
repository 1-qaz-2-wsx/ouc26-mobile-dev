// 小程序侧代码风格约定。以现有主导写法为准，不做大爆炸式重排。
// 用法：编辑器（VS Code + Prettier 扩展）会自动读取本文件。
// 命令行（需先在有 package.json 的目录安装 prettier）：
//   npx prettier --write "pages/**/*.{js,wxml,wxss,json}" "utils/**/*.js"
//   npx prettier --check "pages/**/*.{js,wxml,wxss,json}" "utils/**/*.js"
//
// 策略：逐步收敛，不强推全量格式化。改动某个文件时顺手格式化该文件，
// 这样每个 PR 的 diff 仍然可读，避免 6000+ 行一次性重排淹没真实改动。
module.exports = {
  printWidth: 140,        // 现有代码存在大量长行；140 可容纳而不引发海啸式换行
  tabWidth: 2,
  useTabs: false,
  semi: false,            // 小程序侧现有代码不带分号
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'none',
  bracketSpacing: true,
  arrowParens: 'avoid',   // 现有写法多为 r => ...，即省略单参数括号
  endOfLine: 'lf',
  overrides: [
    {
      // 小程序模板里 {{ }} 与属性换行对渲染无影响，但保持属性逐个换行更易读
      files: '*.wxml',
      options: { parser: 'html', printWidth: 160 }
    }
  ]
}
