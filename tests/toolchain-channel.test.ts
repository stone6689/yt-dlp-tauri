import assert from "node:assert/strict";
import test from "node:test";

import {
  parseChannelRecord,
  renderChannelRecord,
  selectManifestAsset,
} from "../scripts/toolchain/channel.mjs";

function channelFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    revision: "20260711.1",
    manifest: "tools-manifest-20260711.1.json",
    sha256: "a".repeat(64),
    ...overrides,
  };
}

test("channel renderer preserves human release notes", () => {
  const body = "# Stable toolchain\n\nHuman notes\n";
  const next = renderChannelRecord(body, channelFixture());

  assert.match(next, /Human notes/u);
  assert.deepEqual(parseChannelRecord(next), channelFixture());
});

test("channel parser rejects duplicate records", () => {
  const marker = renderChannelRecord("", channelFixture());

  assert.throws(
    () => parseChannelRecord(`${marker}\n${marker}`),
    /multiple toolchain channel records/u,
  );
});

test("channel renderer replaces one record without changing human notes", () => {
  const original = renderChannelRecord("Before\n", channelFixture());
  const nextRecord = channelFixture({
    revision: "20260712.1",
    manifest: "tools-manifest-20260712.1.json",
    sha256: "b".repeat(64),
  });
  const replaced = renderChannelRecord(original, nextRecord);

  assert.match(replaced, /^Before$/mu);
  assert.doesNotMatch(replaced, /20260711\.1/u);
  assert.deepEqual(parseChannelRecord(replaced), nextRecord);
});

test("channel parser rejects unknown fields and mismatched manifest names", () => {
  const unknown = renderChannelRecord("", channelFixture()).replace(
    `"sha256":"${"a".repeat(64)}"`,
    `"sha256":"${"a".repeat(64)}","extra":true`,
  );
  assert.throws(() => parseChannelRecord(unknown), /unknown fields/u);

  const mismatched = `<!-- toolchain-channel\n${JSON.stringify({
    ...channelFixture(),
    manifest: "tools-manifest-20260710.1.json",
  })}\n-->\n`;
  assert.throws(() => parseChannelRecord(mismatched), /must match revision/u);
});

test("channel parser rejects unterminated markers and uppercase digests", () => {
  assert.throws(
    () => parseChannelRecord("<!-- toolchain-channel\n{}"),
    /not terminated/u,
  );
  const uppercase = `<!-- toolchain-channel\n${JSON.stringify({
    ...channelFixture(),
    sha256: "A".repeat(64),
  })}\n-->\n`;
  assert.throws(() => parseChannelRecord(uppercase), /lowercase SHA-256/u);
});

test("manifest asset selection requires one exact HTTPS asset", () => {
  const record = channelFixture();
  const asset = {
    id: 123,
    name: record.manifest,
    browser_download_url:
      "https://github.com/Chlience/yt-dlp-tauri/releases/download/toolchain-stable/tools-manifest-20260711.1.json",
    size: 1024,
  };

  assert.equal(selectManifestAsset({ assets: [asset] }, record), asset);
  assert.throws(
    () => selectManifestAsset({ assets: [asset, { ...asset, id: 456 }] }, record),
    /exactly one release asset/u,
  );
  assert.throws(
    () =>
      selectManifestAsset(
        { assets: [{ ...asset, browser_download_url: "http://example.test/manifest" }] },
        record,
      ),
    /HTTPS download URL/u,
  );
});
