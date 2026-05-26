import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("thumbnail preview does not send referrer to remote CDNs", () => {
  const html = readFileSync("index.html", "utf8");
  const thumbnailTag = html.match(/<img\b[^>]*\bid="thumbnail"[^>]*>/)?.[0] ?? "";

  assert.match(thumbnailTag, /\breferrerpolicy="no-referrer"/);
});
