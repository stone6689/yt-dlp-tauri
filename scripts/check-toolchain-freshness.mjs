import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  checkToolSourceUrl,
  checkUrlWithRetries,
} from "./check-tool-source-urls.mjs";

const DEFAULT_LOCK_PATH = "toolchain-lock.json";
const DEFAULT_MANIFEST_PATH = "src-tauri/tools-manifest.json";

function manifestTools(manifest) {
  const tools = new Map();
  for (const target of manifest?.targets ?? []) {
    for (const tool of target?.tools ?? []) {
      const key = `${target.target}/${tool.name}`;
      const entries = tools.get(key) ?? [];
      entries.push(tool);
      tools.set(key, entries);
    }
  }
  return tools;
}

function unavailableDescription(result, url) {
  const status = typeof result.status === "number" ? String(result.status) : "unknown status";
  const statusText =
    typeof result.statusText === "string" && result.statusText.trim()
      ? ` ${result.statusText.trim()}`
      : "";
  return `${status}${statusText} ${url}`;
}

function addUrl(urls, value, issue, label) {
  if (typeof value !== "string" || value.trim() === "") {
    issue(`${label} is missing a source URL`);
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    issue(`${label} has an invalid source URL: ${value}`);
    return;
  }
  if (parsed.protocol !== "https:") {
    issue(`${label} source URL must use HTTPS: ${value}`);
    return;
  }
  urls.add(parsed.toString());
}

export async function evaluateToolchainFreshness(
  lock,
  manifest,
  checkUrl = checkToolSourceUrl,
) {
  if (!Array.isArray(lock?.sources)) {
    throw new Error("Toolchain lock must contain a sources array");
  }
  const manifestByTool = manifestTools(manifest);
  const knownManifestTools = new Set();
  const checkedUrls = new Map();
  const checkOnce = (url) => {
    if (!checkedUrls.has(url)) {
      checkedUrls.set(url, checkUrlWithRetries(url, checkUrl));
    }
    return checkedUrls.get(url);
  };
  const failedSourceIds = [];
  const problems = [];

  for (const source of [...lock.sources].sort((left, right) => left.id.localeCompare(right.id))) {
    const urls = new Set();
    const sourceProblems = [];
    const issue = (problem) => sourceProblems.push(problem);
    if (!Array.isArray(source.assets)) {
      issue("lock source has no assets array");
    }
    for (const asset of source.assets ?? []) {
      addUrl(urls, asset.sourceUrl, issue, `${asset.target} locked asset`);
      for (const member of asset.members ?? []) {
        const key = `${asset.target}/${member.tool}`;
        knownManifestTools.add(key);
        const entries = manifestByTool.get(key) ?? [];
        if (entries.length === 0) {
          issue(`manifest is missing ${key}`);
        } else if (entries.length > 1) {
          issue(`manifest contains duplicate ${key} entries`);
        } else {
          addUrl(urls, entries[0].sourceUrl, issue, `${key} manifest entry`);
        }
      }
    }

    for (const url of [...urls].sort()) {
      const result = await checkOnce(url);
      if (!result.ok) sourceProblems.push(unavailableDescription(result, url));
    }
    if (sourceProblems.length > 0) {
      failedSourceIds.push(source.id);
      problems.push(`${source.id}: ${sourceProblems.join("; ")}`);
    }
  }

  for (const key of [...manifestByTool.keys()].sort()) {
    if (!knownManifestTools.has(key)) {
      problems.push(`manifest tool ${key} is not represented in toolchain-lock.json`);
    }
  }
  failedSourceIds.sort();
  return {
    ok: problems.length === 0,
    failedSourceIds,
    problems,
  };
}

function parseArgs(argv) {
  const args = {
    lock: DEFAULT_LOCK_PATH,
    manifest: DEFAULT_MANIFEST_PATH,
    jsonOutput: "",
  };
  const flags = new Map([
    ["--lock", "lock"],
    ["--manifest", "manifest"],
    ["--json-output", "jsonOutput"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const property = flags.get(flag);
    if (!property) throw new Error(`Unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    args[property] = value;
    index += 1;
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const lock = JSON.parse(readFileSync(args.lock, "utf8"));
  const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
  const result = await evaluateToolchainFreshness(lock, manifest);
  if (args.jsonOutput) writeFileSync(args.jsonOutput, `${JSON.stringify(result, null, 2)}\n`);

  if (result.ok) {
    process.stdout.write("Toolchain source URLs are healthy\n");
    return;
  }
  process.stderr.write("Toolchain freshness check failed\n");
  for (const problem of result.problems) process.stderr.write(`- ${problem}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
