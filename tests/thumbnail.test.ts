import assert from "node:assert/strict";
import test from "node:test";

import { thumbnailUrlCandidates } from "../src/thumbnail.ts";

test("thumbnailUrlCandidates prefers backend candidates and falls back to legacy field", () => {
  assert.deepEqual(
    thumbnailUrlCandidates({
      thumbnail_url: "http://i0.hdslb.com/bfs/archive/cover.jpg",
      thumbnail_urls: [
        "https://i0.hdslb.com/bfs/archive/cover.jpg",
        "http://i0.hdslb.com/bfs/archive/cover.jpg",
      ],
    }),
    [
      "https://i0.hdslb.com/bfs/archive/cover.jpg",
      "http://i0.hdslb.com/bfs/archive/cover.jpg",
    ],
  );
});

test("thumbnailUrlCandidates trims and deduplicates empty values", () => {
  assert.deepEqual(
    thumbnailUrlCandidates({
      thumbnail_url: " https://example.test/cover.jpg ",
      thumbnail_urls: ["", "https://example.test/cover.jpg"],
    }),
    ["https://example.test/cover.jpg"],
  );
});
