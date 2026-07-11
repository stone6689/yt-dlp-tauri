const MARKER_OPEN = "<!-- toolchain-channel";
const MARKER_CLOSE = "-->";
const SCHEMA_VERSION = 1;
const RECORD_FIELDS = ["schemaVersion", "revision", "manifest", "sha256"];
const REVISION_PATTERN = /^[0-9]{8}\.[1-9][0-9]*$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function parseChannelRecord(releaseBody) {
  const body = requireBody(releaseBody);
  const marker = locateChannelMarker(body);
  const match = marker.text.match(
    /^<!-- toolchain-channel[ \t]*\r?\n([^\r\n]+)\r?\n-->$/u,
  );
  if (!match) throw new Error("toolchain channel record has invalid marker formatting");
  const json = match[1];
  let value;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error(`toolchain channel record contains invalid JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("toolchain channel record must contain a JSON object");
  }
  for (const field of RECORD_FIELDS) {
    const occurrences = json.match(new RegExp(`"${field}"\\s*:`, "gu"))?.length ?? 0;
    if (occurrences > 1) throw new Error(`toolchain channel record has duplicate fields: ${field}`);
  }
  return normalizeChannelRecord(value);
}

export function renderChannelRecord(releaseBody, record) {
  const body = requireBody(releaseBody);
  const normalized = normalizeChannelRecord(record);
  const marker = channelMarker(normalized);
  const starts = markerStarts(body);

  if (starts.length > 1) throw new Error("multiple toolchain channel records found");
  if (starts.length === 1) {
    const existing = locateChannelMarker(body);
    parseChannelRecord(body);
    return `${body.slice(0, existing.start)}${marker}${body.slice(existing.end)}`;
  }

  if (body === "") return `${marker}\n`;
  const separator = body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  return `${body}${separator}${marker}\n`;
}

export function selectManifestAsset(release, record) {
  const normalized = normalizeChannelRecord(record);
  if (!release || !Array.isArray(release.assets)) {
    throw new Error("toolchain release assets must be an array");
  }
  const matches = release.assets.filter((asset) => asset?.name === normalized.manifest);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one release asset named ${normalized.manifest}, found ${matches.length}`,
    );
  }
  const asset = matches[0];
  let downloadUrl;
  try {
    downloadUrl = new URL(asset.browser_download_url);
  } catch {
    throw new Error(`${normalized.manifest} must have an HTTPS download URL`);
  }
  if (downloadUrl.protocol !== "https:" || downloadUrl.username || downloadUrl.password) {
    throw new Error(`${normalized.manifest} must have an HTTPS download URL`);
  }
  if (downloadUrl.hostname !== "github.com" || downloadUrl.search || downloadUrl.hash) {
    throw new Error(`${normalized.manifest} must have an immutable GitHub download URL`);
  }
  if (
    !(
      (Number.isSafeInteger(asset.id) && asset.id > 0) ||
      (typeof asset.id === "string" && /^[1-9][0-9]*$/u.test(asset.id))
    )
  ) {
    throw new Error(`${normalized.manifest} must have a release asset ID`);
  }
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`${normalized.manifest} must have a positive byte size`);
  }
  return asset;
}

export function compareToolchainRevisions(left, right) {
  const [leftDate, leftSequence] = revisionParts(left);
  const [rightDate, rightSequence] = revisionParts(right);
  return leftDate.localeCompare(rightDate) || leftSequence - rightSequence;
}

function normalizeChannelRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("toolchain channel record must be an object");
  }
  const keys = Object.keys(record);
  const unknown = keys.filter((key) => !RECORD_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`toolchain channel record has unknown fields: ${unknown.join(", ")}`);
  }
  const missing = RECORD_FIELDS.filter((key) => !Object.hasOwn(record, key));
  if (missing.length > 0) {
    throw new Error(`toolchain channel record is missing fields: ${missing.join(", ")}`);
  }
  if (record.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported toolchain channel schema: ${record.schemaVersion}`);
  }
  if (!REVISION_PATTERN.test(record.revision ?? "")) {
    throw new Error(`Invalid toolchain channel revision: ${record.revision}`);
  }
  const expectedManifest = `tools-manifest-${record.revision}.json`;
  if (record.manifest !== expectedManifest) {
    throw new Error(`Channel manifest must match revision ${record.revision}`);
  }
  if (!SHA256_PATTERN.test(record.sha256 ?? "")) {
    throw new Error("Channel digest must be a 64-character lowercase SHA-256");
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: record.revision,
    manifest: record.manifest,
    sha256: record.sha256,
  };
}

function locateChannelMarker(body) {
  const starts = markerStarts(body);
  if (starts.length === 0) throw new Error("toolchain channel record is missing");
  if (starts.length > 1) throw new Error("multiple toolchain channel records found");
  const start = starts[0];
  const close = body.indexOf(MARKER_CLOSE, start + MARKER_OPEN.length);
  if (close < 0) throw new Error("toolchain channel record is not terminated");
  const end = close + MARKER_CLOSE.length;
  return { start, end, text: body.slice(start, end) };
}

function markerStarts(body) {
  const starts = [];
  let offset = 0;
  while (offset < body.length) {
    const start = body.indexOf(MARKER_OPEN, offset);
    if (start < 0) break;
    starts.push(start);
    offset = start + MARKER_OPEN.length;
  }
  return starts;
}

function channelMarker(record) {
  return `${MARKER_OPEN}\n${JSON.stringify(record)}\n${MARKER_CLOSE}`;
}

function revisionParts(value) {
  if (!REVISION_PATTERN.test(value ?? "")) {
    throw new Error(`Invalid toolchain revision: ${value}`);
  }
  const [date, sequence] = value.split(".");
  return [date, Number(sequence)];
}

function requireBody(value) {
  if (typeof value !== "string") throw new Error("toolchain release body must be a string");
  return value;
}
