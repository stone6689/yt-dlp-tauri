import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  candidateAssetsForRevision,
  prepareCandidateBundle,
  verifyCandidateBundle,
} from "../scripts/toolchain/candidate-bundle.mjs";
import { parsePrepareCandidateArgs } from "../scripts/prepare-toolchain-candidate.mjs";
import { parseVerifyCandidateArgs } from "../scripts/verify-toolchain-candidate.mjs";

const REVISION = "20260712.1";
const RELEASE_TAG = `toolchain-${REVISION}`;
const REPOSITORY = "Chlience/yt-dlp-tauri-toolchain";

function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function descriptor(assetName: string, bytes: Uint8Array) {
  return {
    repository: REPOSITORY,
    releaseTag: RELEASE_TAG,
    assetName,
    size: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function asset({
  target,
  sourceUrl,
  assetName,
  bytes,
  kind,
}: {
  target: string;
  sourceUrl: string;
  assetName: string;
  bytes: Uint8Array;
  kind: "file" | "zip";
}) {
  return {
    target,
    sourceUrl,
    assetName,
    kind,
    size: bytes.byteLength,
    sha256: sha256(bytes),
    archive: descriptor(`archived-${assetName}`, bytes),
    members: [],
  };
}

function fixture() {
  const shared = new TextEncoder().encode("shared-macos-tool");
  const windows = new TextEncoder().encode("windows-tool-archive");
  const sharedUrl = "https://github.com/upstream/tool/releases/download/v1/tool-macos";
  const windowsUrl =
    "https://github.com/upstream/tool/releases/download/v1/tool-windows.zip";
  const lock = {
    schemaVersion: 2,
    revision: REVISION,
    generatedAtUtc: "2026-07-12T00:00:00.000Z",
    targets: ["macos-arm64", "macos-x64", "win-x64"],
    sources: [
      {
        id: "tool",
        version: "v1",
        assets: [
          asset({
            target: "macos-arm64",
            sourceUrl: sharedUrl,
            assetName: "tool-macos",
            bytes: shared,
            kind: "file",
          }),
          asset({
            target: "macos-x64",
            sourceUrl: sharedUrl,
            assetName: "tool-macos",
            bytes: shared,
            kind: "file",
          }),
          asset({
            target: "win-x64",
            sourceUrl: windowsUrl,
            assetName: "tool-windows.zip",
            bytes: windows,
            kind: "zip",
          }),
        ],
      },
    ],
  };
  const policy = {
    approvedHosts: ["github.com"],
  };
  const responses = new Map([
    [sharedUrl, shared],
    [windowsUrl, windows],
  ]);
  const fetchImpl = async (url: string | URL) => {
    const bytes = responses.get(String(url));
    if (!bytes) return new Response("missing", { status: 404 });
    return new Response(bytes, {
      status: 200,
      headers: { "content-length": String(bytes.byteLength) },
    });
  };
  return { lock, policy, fetchImpl, shared, windows };
}

async function withTempDirectory(
  callback: (directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "yt-dlp-candidate-test-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const context = {
  repositoryId: "12345",
  pullRequestNumber: 77,
  headSha: "a".repeat(40),
};

test("production revision contains ten unique candidate byte objects", () => {
  const lock = JSON.parse(readFileSync("toolchain-lock.json", "utf8"));
  const assets = candidateAssetsForRevision(lock);

  assert.equal(assets.length, 10);
  assert.equal(new Set(assets.map((entry) => entry.sha256)).size, 10);
  assert.equal(
    assets.reduce((count, entry) => count + entry.references.length, 0),
    11,
  );
});

test("candidate preparation downloads each digest once and writes a canonical index", async () => {
  await withTempDirectory(async (directory) => {
    const { lock, policy, fetchImpl } = fixture();
    let requests = 0;
    const index = await prepareCandidateBundle({
      policy,
      lock,
      lockBytes: Buffer.from(`${JSON.stringify(lock, null, 2)}\n`),
      outputDirectory: directory,
      fetchImpl: async (...args: Parameters<typeof fetchImpl>) => {
        requests += 1;
        return fetchImpl(...args);
      },
      context,
      now: new Date("2026-07-12T01:02:03.000Z"),
    });

    assert.equal(requests, 2);
    assert.equal(index.assets.length, 2);
    assert.equal(index.assets[0].path, `assets/${index.assets[0].sha256}`);
    assert.equal(index.repositoryId, context.repositoryId);
    assert.equal(index.pullRequestNumber, context.pullRequestNumber);
    assert.equal(index.headSha, context.headSha);
    const written = await readFile(join(directory, "candidate-assets.json"), "utf8");
    assert.equal(written, `${JSON.stringify(index, null, 2)}\n`);

    const verified = await verifyCandidateBundle({
      lock,
      lockBytes: Buffer.from(`${JSON.stringify(lock, null, 2)}\n`),
      directory,
      expectedContext: context,
    });
    assert.deepEqual(verified, index);
  });
});

test("candidate verification rejects modified bytes", async () => {
  await withTempDirectory(async (directory) => {
    const { lock, policy, fetchImpl } = fixture();
    await prepareCandidateBundle({
      policy,
      lock,
      outputDirectory: directory,
      fetchImpl,
      context,
    });
    const [entry] = candidateAssetsForRevision(lock);
    await writeFile(join(directory, entry.path), "modified");

    await assert.rejects(
      verifyCandidateBundle({ lock, directory, expectedContext: context }),
      /size mismatch|SHA-256 mismatch/u,
    );
  });
});

test("candidate verification rejects extra files and context mismatches", async () => {
  await withTempDirectory(async (directory) => {
    const { lock, policy, fetchImpl } = fixture();
    await prepareCandidateBundle({
      policy,
      lock,
      outputDirectory: directory,
      fetchImpl,
      context,
    });

    await assert.rejects(
      verifyCandidateBundle({
        lock,
        directory,
        expectedContext: { ...context, headSha: "b".repeat(40) },
      }),
      /head SHA/u,
    );

    await writeFile(join(directory, "assets", "unexpected"), "unexpected");
    await assert.rejects(
      verifyCandidateBundle({ lock, directory, expectedContext: context }),
      /unexpected candidate asset/u,
    );
  });
});

test("candidate preparation rejects unapproved source hosts", async () => {
  await withTempDirectory(async (directory) => {
    const { lock, policy, fetchImpl } = fixture();
    lock.sources[0].assets[0].sourceUrl = "https://unapproved.test/tool";

    await assert.rejects(
      prepareCandidateBundle({
        policy,
        lock,
        outputDirectory: directory,
        fetchImpl,
        context,
      }),
      /unapproved source host/u,
    );
  });
});

test("candidate CLIs parse exact paths and trust context", () => {
  assert.deepEqual(
    parsePrepareCandidateArgs([
      "--policy",
      "policy.json",
      "--lock",
      "lock.json",
      "--output",
      "candidate",
      "--repository-id",
      "12345",
      "--pull-request",
      "77",
      "--head-sha",
      "a".repeat(40),
      "--created-at",
      "2026-07-12T01:02:03.000Z",
    ]),
    {
      policyPath: "policy.json",
      lockPath: "lock.json",
      outputDirectory: "candidate",
      repositoryId: "12345",
      pullRequestNumber: "77",
      headSha: "a".repeat(40),
      createdAtUtc: "2026-07-12T01:02:03.000Z",
    },
  );
  assert.deepEqual(
    parseVerifyCandidateArgs([
      "--lock",
      "lock.json",
      "--directory",
      "candidate",
      "--head-sha",
      "a".repeat(40),
    ]),
    {
      lockPath: "lock.json",
      directory: "candidate",
      repositoryId: "",
      pullRequestNumber: "",
      headSha: "a".repeat(40),
    },
  );
  assert.throws(
    () => parsePrepareCandidateArgs(["--unknown", "value"]),
    /Unknown argument/u,
  );
});
