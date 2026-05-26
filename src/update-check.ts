export type LatestRelease = {
  tagName: string;
  releaseUrl: string;
};

export type GithubAccessMode = "direct" | "gh-proxy";

export type GithubHttpError = {
  status: number;
  statusText: string;
  message: string;
  isRateLimited: boolean;
  rateLimitResetEpochSeconds?: number;
};

export type UpdateStatus =
  | {
      kind: "available";
      currentVersion: string;
      latestVersion: string;
      releaseUrl: string;
    }
  | {
      kind: "current";
      currentVersion: string;
      latestVersion: string;
    };

export function compareVersions(firstVersion: string, secondVersion: string) {
  const firstParts = versionParts(firstVersion);
  const secondParts = versionParts(secondVersion);
  const partCount = Math.max(firstParts.length, secondParts.length);

  for (let index = 0; index < partCount; index += 1) {
    const first = firstParts[index] ?? 0;
    const second = secondParts[index] ?? 0;

    if (first < second) {
      return -1;
    }
    if (first > second) {
      return 1;
    }
  }

  return 0;
}

export function getUpdateStatus(currentVersion: string, latestRelease: LatestRelease): UpdateStatus {
  const normalizedCurrentVersion = normalizeVersion(currentVersion);
  const normalizedLatestVersion = normalizeVersion(latestRelease.tagName);

  if (compareVersions(normalizedCurrentVersion, normalizedLatestVersion) < 0) {
    return {
      kind: "available",
      currentVersion: normalizedCurrentVersion,
      latestVersion: normalizedLatestVersion,
      releaseUrl: latestRelease.releaseUrl,
    };
  }

  return {
    kind: "current",
    currentVersion: normalizedCurrentVersion,
    latestVersion: normalizedLatestVersion,
  };
}

export function parseLatestRelease(payload: unknown): LatestRelease | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const release = payload as Record<string, unknown>;
  if (typeof release.tag_name !== "string" || typeof release.html_url !== "string") {
    return null;
  }

  return {
    tagName: release.tag_name,
    releaseUrl: release.html_url,
  };
}

export function resolveGithubUrl(url: string, accessMode: GithubAccessMode) {
  if (accessMode === "direct" || url.startsWith("https://gh-proxy.com/")) {
    return url;
  }

  return `https://gh-proxy.com/${url}`;
}

export async function parseGithubHttpError(response: Response): Promise<GithubHttpError> {
  const statusLine = `${response.status} ${response.statusText}`.trim();
  const apiMessage = await readGithubApiMessage(response);
  const remaining = response.headers.get("x-ratelimit-remaining");
  const resetEpochSeconds = parseRateLimitReset(response.headers.get("x-ratelimit-reset"));
  const isRateLimited = response.status === 403 && remaining === "0";

  return {
    status: response.status,
    statusText: response.statusText,
    message: apiMessage ? `${statusLine}: ${apiMessage}` : statusLine,
    isRateLimited,
    rateLimitResetEpochSeconds: isRateLimited ? resetEpochSeconds : undefined,
  };
}

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "").split(/[+-]/)[0] || "0";
}

function versionParts(version: string) {
  return normalizeVersion(version)
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

async function readGithubApiMessage(response: Response) {
  try {
    const payload = (await response.clone().json()) as unknown;
    if (payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).message === "string") {
      return (payload as Record<string, string>).message;
    }
  } catch {
    return "";
  }
  return "";
}

function parseRateLimitReset(value: string | null) {
  if (!value) {
    return undefined;
  }

  const epochSeconds = Number.parseInt(value, 10);
  return Number.isFinite(epochSeconds) ? epochSeconds : undefined;
}
