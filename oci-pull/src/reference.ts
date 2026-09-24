/**
 * Base interface for container image references.
 * Contains the registry and repository components common to all reference types.
 */
interface ReferenceBase {
  readonly registry: string
  readonly repository: string
}
/**
 * Represents a container image reference identified by a tag (e.g., "ubuntu:22.04").
 */
export interface TaggedReference extends ReferenceBase {
  readonly kind: "tag"
  readonly tag: string
}
/**
 * Represents a container image reference identified by a digest (e.g., "ubuntu@sha256:abc123...").
 * Digests are content-addressable and immutable, unlike tags.
 */
export interface DigestedReference extends ReferenceBase {
  readonly kind: "digest"
  readonly digest: string
}
/** Union type representing any valid container image reference. */
export type Reference = TaggedReference | DigestedReference

/**
 * Error thrown when a container image reference string cannot be parsed or is invalid.
 * Stores both the original input and a description of the validation problem.
 */
export class InvalidReferenceError extends Error {
  readonly input: string

  constructor(input: string, problem: string) {
    super(`invalid image reference "${input}": ${problem}`)
    this.name = "InvalidReferenceError"
    this.input = input
  }
}

/** Default registry used when none is specified (Docker Hub). */
export const DEFAULT_REGISTRY = "docker.io"
/** Default tag used when none is specified. */
const DEFAULT_TAG = "latest"
/** Prefix applied to official images on Docker Hub (e.g., "library/ubuntu"). */
const OFFICIAL_PREFIX = "library/"

/**
 * Determines if a string looks like a registry hostname.
 * Registries contain dots (e.g., "docker.io"), colons for ports (e.g., "localhost:5000"),
 * or are exactly "localhost".
 */
function looksLikeRegistry(candidate: string): boolean {
  return (
    candidate === "localhost" ||
    candidate.includes(".") ||
    candidate.includes(":")
  )
}

/**
 * Splits an image name into registry and repository components.
 * If no registry is found (e.g., "ubuntu:latest"), defaults to Docker Hub.
 * Examples:
 *   "ubuntu" -> ["docker.io", "ubuntu"]
 *   "myregistry.com/myrepo" -> ["myregistry.com", "myrepo"]
 *   "localhost:5000/myrepo" -> ["localhost:5000", "myrepo"]
 */
function splitRegistry(name: string): [registry: string, repository: string] {
  const slash = name.indexOf("/")
  if (slash === -1) {
    return [DEFAULT_REGISTRY, name]
  }
  const head = name.slice(0, slash)
  if (!looksLikeRegistry(head)) {
    return [DEFAULT_REGISTRY, name]
  }
  return [head, name.slice(slash + 1)]
}
/** Regex for valid tags: start with word char, 1-128 chars total, alphanumeric with dots/hyphens. */
const TAG_PATTERN = /^[\w][\w.-]{0,127}$/
/** Regex for valid digests: algorithm:hash format (e.g., "sha256:abc123..."). */
const DIGEST_PATTERN = /^[a-z0-9]+(?:[.+_-][a-z0-9]+)*:[0-9a-fA-F]{32,}$/
/** Regex for valid repository names: lowercase alphanumeric with optional separators and path segments. */
const REPOSITORY_PATTERN =
  /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/

/**
 * Extracts and validates the digest component from a reference string.
 * The digest follows the '@' character and has format "algorithm:hash" (e.g., "@sha256:abc123").
 * Removes the digest portion from the input (from '@' onward) before returning it.
 * @param rest - The input string to search for digest
 * @param input - The original input (used for error reporting)
 * @returns The digest (without '@', or undefined if absent) and the rest of the string before '@'
 * @throws InvalidReferenceError if digest format is invalid
 */
function extractDigest(
  rest: string,
  input: string,
): { digest: string | undefined; rest: string } {
  const at = rest.indexOf("@")
  if (at === -1) {
    return { digest: undefined, rest }
  }
  const digest = rest.slice(at + 1)
  if (!DIGEST_PATTERN.test(digest)) {
    throw new InvalidReferenceError(input, `"${digest}" is not a valid digest`)
  }
  return { digest, rest: rest.slice(0, at) }
}

/**
 * Extracts and validates the tag component from a reference string.
 * The tag follows the ':' character and is constrained after any registry port.
 * Only the rightmost ':' after the last '/' is considered (to ignore ':' in registry:port).
 * Modifies the rest string by removing everything from ':' onward.
 * Examples:
 *   "ubuntu:22.04" -> tag="22.04", rest="ubuntu"
 *   "registry.com:5000/repo:latest" -> tag="latest", rest="registry.com:5000/repo"
 * @param rest - The input string to search for tag
 * @param input - The original input (used for error reporting)
 * @returns Object with extracted tag and remaining string, tag is undefined if no tag present
 * @throws InvalidReferenceError if tag format is invalid
 */
function extractTag(
  rest: string,
  input: string,
): { tag: string | undefined; rest: string } {
  const colon = rest.lastIndexOf(":")
  const lastSlash = rest.lastIndexOf("/")
  if (colon === -1 || colon <= lastSlash) {
    return { tag: undefined, rest }
  }
  const tag = rest.slice(colon + 1)
  rest = rest.slice(0, colon)
  if (!TAG_PATTERN.test(tag)) {
    throw new InvalidReferenceError(input, `"${tag}" is not a valid tag`)
  }
  return { tag, rest }
}

/**
 * Parses a container image reference string into structured components.
 * Supports formats like:
 *   "ubuntu" -> Tag reference to "library/ubuntu" on Docker Hub
 *   "ubuntu:22.04" -> Tagged reference with custom tag
 *   "registry.io/repo:tag" -> Custom registry
 *   "registry.io/repo@sha256:abc..." -> Digest-based reference
 *
 * Parsing order:
 *   1. Extract digest (after '@') if present
 *   2. Extract tag (after ':') if present
 *   3. Split remaining string into registry and repository
 *   4. Apply Docker Hub official prefix if needed (e.g., "ubuntu" -> "library/ubuntu")
 *   5. Validate all components
 *
 * @param input - The container image reference string to parse
 * @returns Either a TaggedReference or DigestedReference with all components
 * @throws InvalidReferenceError if the input is empty or any component is invalid
 */
export function parseReference(input: string): Reference {
  if (input === "") {
    throw new InvalidReferenceError(input, "the name is empty")
  }
  const { digest, rest: restAfterDigest } = extractDigest(input, input)
  const { tag, rest: restAfterTag } = extractTag(restAfterDigest, input)
  const [registry, name] = splitRegistry(restAfterTag)
  const repository =
    registry === DEFAULT_REGISTRY && !name.includes("/")
      ? OFFICIAL_PREFIX + name
      : name

  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new InvalidReferenceError(
      input,
      `"${name}" is not a valid repository name`,
    )
  }

  if (digest !== undefined) {
    return { kind: "digest", registry, repository, digest }
  }
  return { kind: "tag", registry, repository, tag: tag ?? DEFAULT_TAG }
}

export function target(ref: Reference): string {
  switch (ref.kind) {
    case "tag":
      return ref.tag
    case "digest":
      return ref.digest
  }
}
