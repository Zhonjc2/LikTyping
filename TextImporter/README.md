# TextImporter

管理员侧导入工具。它不会改动现有网页逻辑，只负责把文档整理成当前前端可直接读取的 `texts.json`。

## 支持的输入

- `.txt`
- `.md`
- `.docx`

## 会自动做什么

- 提取正文文本
- 按段落和句号、问号、感叹号、分号切分候选句子
- 使用 `nodejieba` 做中文分词
- 把 `lexicon.txt` 里的自定义词写入 `jieba` 词典，优先保留专有名词和固定词组
- 使用 `pinyin-pro` 生成无声调拼音
- 输出当前站点兼容的 JSON 结构：

```json
[
  {
    "hanzi": "优秀的代码像好文章，结构清晰，表达准确。",
    "words": ["优秀", "的", "代码", "像", "好", "文章", "结构", "清晰", "表达", "准确"],
    "pinyinWords": ["youxiu", "de", "daima", "xiang", "hao", "wenzhang", "jiegou", "qingxi", "biaoda", "zhunque"]
  }
]
```

## 使用方式

1. 安装依赖

```bash
cd TextImporter
npm install
```

2. 把原始文档放进 `TextImporter/input/`

3. 如果有行业词、产品名、固定搭配，把它们逐行写进 `TextImporter/lexicon.txt`

4. 生成根目录 `texts.json`

```bash
npm run import
```

5. 如果想保留原有题库并追加去重

```bash
npm run import -- --append
```

## 常用参数

```bash
npm run import -- --input ./input/my.docx
npm run import -- --output ./output/generated.json
npm run import -- --lexicon ./lexicon.txt
npm run import -- --min-chars 12 --max-chars 80
npm run import -- --min-words 3
```

## 提升分词效果的推荐做法

默认分词现在基于 `jieba`，比轻量规则分词更适合中文正文，但技术名词、产品名、固定搭配仍然建议配合自定义词库使用。

更稳妥的做法：

- 把常见专有词加入 `lexicon.txt`
- 导入一次后抽查生成的 `words`
- 发现切错的词，继续补到 `lexicon.txt`
- 重新运行 `npm run import`

这个方案特别适合你的场景，因为题库来源往往是同一类文章，词汇会重复出现，维护成本很低。

## 目录建议

```text
TextImporter/
  importer.mjs
  lexicon.txt
  package.json
  README.md
  input/
```

首次使用前请手动创建 `input/`，或者直接指定 `--input` 到某个文件/目录。
