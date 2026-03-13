import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";
import nodejieba from "nodejieba";
import { pinyin } from "pinyin-pro";

const DEFAULT_INPUT_DIR = "input";
const DEFAULT_OUTPUT_PATH = "../texts.json";
const DEFAULT_LEXICON_PATH = "lexicon.txt";

function parseArgs(argv) {
  const options = {
    input: DEFAULT_INPUT_DIR,
    output: DEFAULT_OUTPUT_PATH,
    lexicon: DEFAULT_LEXICON_PATH,
    append: false,
    minChars: 8,
    minWords: 2,
    maxChars: 120
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--append") {
      options.append = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`Missing value for argument: ${arg}`);
    }
    index += 1;

    if (key === "input") {
      options.input = value;
    } else if (key === "output") {
      options.output = value;
    } else if (key === "lexicon") {
      options.lexicon = value;
    } else if (key === "min-chars") {
      options.minChars = Number(value);
    } else if (key === "min-words") {
      options.minWords = Number(value);
    } else if (key === "max-chars") {
      options.maxChars = Number(value);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run import -- [options]

Options:
  --input <path>       Input file or directory. Default: ${DEFAULT_INPUT_DIR}
  --output <path>      Output JSON path. Default: ${DEFAULT_OUTPUT_PATH}
  --lexicon <path>     Custom lexicon file. Default: ${DEFAULT_LEXICON_PATH}
  --append             Merge into existing output file instead of replacing it
  --min-chars <n>      Minimum visible characters per sentence. Default: 8
  --min-words <n>      Minimum segmented words per sentence. Default: 2
  --max-chars <n>      Maximum visible characters per sentence. Default: 120
  --help, -h           Show this help
`);
}

function normalizeSourceText(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntoCandidates(text) {
  const normalized = normalizeSourceText(text);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  const candidates = [];

  for (const paragraph of paragraphs) {
    const sentenceParts = paragraph
      .split(/(?<=[。！？!?；;])/u)
      .map((item) => item.trim())
      .filter(Boolean);

    if (sentenceParts.length === 0) {
      candidates.push(paragraph);
      continue;
    }

    candidates.push(...sentenceParts);
  }

  return candidates;
}

function stripDecorators(text) {
  return text
    .replace(/^[\s"'“”‘’《》【】\[\]()（）<>]+/gu, "")
    .replace(/[\s"'“”‘’《》【】\[\]()（）<>]+$/gu, "")
    .trim();
}

function countVisibleChars(text) {
  return [...text.replace(/\s+/g, "")].length;
}

function isUsefulSegment(segment) {
  return /[\p{Script=Han}A-Za-z0-9]/u.test(segment);
}

function normalizeWord(word) {
  return word.replace(/\s+/g, "").trim();
}

function initializeJiebaLexicon(entries) {
  const normalizedEntries = entries
    .map((entry) => normalizeWord(entry))
    .filter((entry) => entry.length >= 2);

  normalizedEntries.forEach((entry) => {
    nodejieba.insertWord(entry);
  });

  return normalizedEntries;
}

function segmentWords(sentence) {
  return nodejieba
    .cut(sentence, true)
    .map((part) => normalizeWord(part))
    .filter((token) => token && isUsefulSegment(token));
}

function wordToPinyin(word) {
  const syllables = pinyin(word, {
    toneType: "none",
    type: "array",
    nonZh: "consecutive"
  });

  return syllables
    .map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, ""))
    .join("");
}

function buildSample(sentence) {
  const hanzi = stripDecorators(sentence);
  const words = segmentWords(hanzi);
  const pinyinWords = words.map(wordToPinyin).filter(Boolean);

  if (words.length !== pinyinWords.length) {
    return null;
  }

  return { hanzi, words, pinyinWords };
}

function shouldKeepSample(sample, options) {
  if (!sample) {
    return false;
  }

  const visibleChars = countVisibleChars(sample.hanzi);
  if (visibleChars < options.minChars || visibleChars > options.maxChars) {
    return false;
  }

  if (sample.words.length < options.minWords) {
    return false;
  }

  return true;
}

async function listFiles(entryPath) {
  const stat = await fs.stat(entryPath);
  if (stat.isFile()) {
    return [entryPath];
  }

  const children = await fs.readdir(entryPath, { withFileTypes: true });
  const results = [];

  for (const child of children) {
    if (child.name.startsWith(".")) {
      continue;
    }
    const childPath = path.join(entryPath, child.name);
    if (child.isDirectory()) {
      results.push(...(await listFiles(childPath)));
    } else {
      results.push(childPath);
    }
  }

  return results;
}

async function readInputFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".txt" || ext === ".md") {
    return fs.readFile(filePath, "utf8");
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  throw new Error(`Unsupported file type: ${filePath}`);
}

async function loadExistingSamples(outputPath, append) {
  if (!append) {
    return [];
  }

  try {
    const raw = await fs.readFile(outputPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function loadLexicon(lexiconPath) {
  try {
    const raw = await fs.readFile(lexiconPath, "utf8");
    return raw
      .split(/\r?\n/g)
      .map((line) => line.replace(/#.*/g, "").trim())
      .filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function dedupeSamples(samples) {
  const seen = new Set();
  return samples.filter((sample) => {
    const key = sample.hanzi;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const baseDir = path.dirname(fileURLToPath(import.meta.url));
  const inputPath = path.resolve(baseDir, options.input);
  const outputPath = path.resolve(baseDir, options.output);
  const lexiconPath = path.resolve(baseDir, options.lexicon);
  const lexiconEntries = await loadLexicon(lexiconPath);
  const activeLexiconEntries = initializeJiebaLexicon(lexiconEntries);

  const files = await listFiles(inputPath);
  const supportedFiles = files.filter((filePath) =>
    [".txt", ".md", ".docx"].includes(path.extname(filePath).toLowerCase())
  );

  if (supportedFiles.length === 0) {
    throw new Error(`No supported files found under: ${inputPath}`);
  }

  const importedSamples = [];

  for (const filePath of supportedFiles) {
    const rawText = await readInputFile(filePath);
    const candidates = splitIntoCandidates(rawText);
    for (const candidate of candidates) {
      const sample = buildSample(candidate);
      if (shouldKeepSample(sample, options)) {
        importedSamples.push(sample);
      }
    }
  }

  const existingSamples = await loadExistingSamples(outputPath, options.append);
  const mergedSamples = dedupeSamples([...existingSamples, ...importedSamples]);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(mergedSamples, null, 2)}\n`, "utf8");

  console.log(`Imported files: ${supportedFiles.length}`);
  console.log(`New samples before dedupe: ${importedSamples.length}`);
  console.log(`Output samples: ${mergedSamples.length}`);
  console.log(`Output path: ${outputPath}`);
  console.log(`Custom lexicon entries: ${activeLexiconEntries.length}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
