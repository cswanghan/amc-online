# AMC Online

Australian Mathematics Competition 在线练习站点骨架。

当前仓库已经具备两层能力：

- 站点基础设施：Cloudflare Pages + Functions + D1 的登录、做题记录、统计能力
- AMC 题库资产层：从原始 `PDF/PNG` 题库构建标准化 `public/library` 与 `public/data/index.json`

## 当前范围

- 层级：`AMC A / AMC B / AMC C`
- 年份：`2007-2025`
- 页面：
  - 首页 `public/index.html`
  - 真题浏览 `public/papers.html`
  - 在线练习入口 `public/quiz.html`
- 题库构建脚本：
  - `scripts/build_amc_library.py`

当前在线练习页已经切换成 AMC 配置，且已有部分年份完成题图切割与逐题 JSON 生成；脚本会先产出可浏览的试卷/答案资源和总索引。

## 目录

```text
├── extracted/                  # 原始 AMC 题库解压目录
├── public/
│   ├── index.html             # AMC 首页
│   ├── papers.html            # 年份 / 试卷 / 答案浏览
│   ├── quiz.html              # 在线练习入口与数据状态页
│   ├── library/               # 由脚本生成的标准化静态资产
│   └── data/index.json        # 由脚本生成的题库总索引
├── scripts/
│   └── build_amc_library.py   # 题库清洗与 manifest 构建
├── functions/api/             # 登录、提交、统计等 Pages Functions
├── src/db/                    # D1 schema
└── wrangler.toml
```

## 使用

```bash
npm install
npm run build:library
npm run dev
```

## 题库构建

`npm run build:library` 会做三件事：

1. 扫描 `extracted/澳大利亚AMC`
2. 复制试卷/答案到 `public/library/<level>/<year>/`
3. 生成 `public/data/index.json`

如果只想检查索引而不复制文件：

```bash
npm run check:library
```

## 题集生成

当前已打通的在线题集：

- `AMC-A 2025`
- `AMC-B 2024`
- `AMC-B 2025`
- `AMC-C 2025`

单独生成 `AMC-B 2024`：

```bash
npm run generate:2024b
```

批量生成当前所有可练题集：

```bash
npm run generate:ready
```

仅生成 2025 三个层级：

```bash
npm run generate:2025
```

生成后会输出：

- `public/generated/b/2024/*.png`
- `public/generated/<level>/<year>/*.png`
- `public/data/generated/<level>/<year>.json`

再刷新站点后，对应的 `quiz.html?level=<level>&year=<year>` 就会进入真实做题流程。
