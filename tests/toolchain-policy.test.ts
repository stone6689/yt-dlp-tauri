import assert from "node:assert/strict";
import test from "node:test";

import {
  readToolchainPolicy,
  sourceById,
  validateToolchainPolicy,
} from "../scripts/toolchain/policy.mjs";

test("production policy covers every populated manifest target", () => {
  const policy = readToolchainPolicy("toolchain-policy.json");

  assert.deepEqual(policy.targets, ["win-x64", "macos-x64", "macos-arm64"]);
  assert.deepEqual(
    policy.sources.map((source) => source.id),
    [
      "yt-dlp",
      "deno",
      "ffmpeg-windows",
      "ffmpeg-macos-x64",
      "ffmpeg-macos-arm64",
    ],
  );
  assert.equal(sourceById(policy, "deno").repository, "denoland/deno");
});

test("policy rejects an unapproved source host", () => {
  assert.throws(
    () =>
      validateToolchainPolicy({
        schemaVersion: 1,
        targets: ["win-x64"],
        approvedHosts: ["github.com"],
        sources: [
          {
            id: "bad",
            adapter: "redirect-release",
            selection: "latest-redirect",
            assets: [
              {
                target: "win-x64",
                url: "https://evil.test/tool.zip",
                kind: "zip",
                members: [],
              },
            ],
          },
        ],
      }),
    /unapproved host evil\.test/,
  );
});

test("policy rejects duplicate source identifiers", () => {
  const source = {
    id: "duplicate",
    adapter: "github-release",
    repository: "owner/repository",
    selection: "latest-stable",
    assets: [
      {
        target: "win-x64",
        assetName: "tool.exe",
        kind: "file",
        members: [
          {
            tool: "tool",
            path: "Tools/win-x64/tool/tool.exe",
            licenseNotes: "Test license",
          },
        ],
      },
    ],
  };

  assert.throws(
    () =>
      validateToolchainPolicy({
        schemaVersion: 1,
        targets: ["win-x64"],
        approvedHosts: ["github.com"],
        sources: [source, { ...source }],
      }),
    /duplicate source id duplicate/,
  );
});
