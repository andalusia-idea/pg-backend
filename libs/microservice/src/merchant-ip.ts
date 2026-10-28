import { BlockList, isIPv4, isIPv6 } from 'node:net';

/**
 * Merchant IP allowlisting.
 *
 * An entry is either a bare address (`203.0.113.5`) or CIDR notation
 * (`198.51.100.0/24`), IPv4 or IPv6. Matching is delegated to Node's built-in
 * `net.BlockList`, which also handles IPv4-mapped IPv6 (`::ffff:203.0.113.5`)
 * - the form a proxy often presents an IPv4 client in.
 */

const parseEntry = (
  entry: string,
): { address: string; prefix: number | null } | null => {
  const [address, prefixPart, ...rest] = entry.trim().split('/');
  if (rest.length > 0 || !address) return null;

  const family = isIPv4(address) ? 4 : isIPv6(address) ? 6 : null;
  if (family === null) return null;

  if (prefixPart === undefined) return { address, prefix: null };

  const prefix = Number(prefixPart);
  const maxPrefix = family === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix)
    return null;

  return { address, prefix };
};

/**
 * Whether an allowlist entry is well-formed.
 *
 * Use this wherever a merchant supplies one, so a typo is rejected at the
 * point of entry rather than silently narrowing their allowlist later.
 */
export const isValidIpAllowlistEntry = (entry: string): boolean =>
  parseEntry(entry) !== null;

/**
 * Whether `ip` falls inside any entry of `allowedIps`.
 *
 * An **empty allowlist means unrestricted** - the feature is opt-in, and most
 * merchants (small shops on dynamic consumer connections) will never use it.
 *
 * A malformed entry is skipped rather than throwing. Skipping narrows the
 * allowlist, so the failure direction is restrictive: a bad entry can lock a
 * merchant out, never let a stranger in. `isValidIpAllowlistEntry` is what
 * stops one being stored in the first place.
 */
export const isIpAllowed = (
  ip: string | null | undefined,
  allowedIps: string[],
): boolean => {
  if (allowedIps.length === 0) return true;

  // An allowlist is configured but the caller's address is unknown - reject.
  // This is the shape a misconfigured `trustProxy` takes, and answering "allow"
  // would silently disable the control for every merchant using it.
  if (!ip) return false;

  const family = isIPv4(ip) ? 'ipv4' : isIPv6(ip) ? 'ipv6' : null;
  if (family === null) return false;

  const blockList = new BlockList();
  let usable = 0;

  for (const entry of allowedIps) {
    const parsed = parseEntry(entry);
    if (!parsed) continue;

    const entryFamily = isIPv4(parsed.address) ? 'ipv4' : 'ipv6';
    if (parsed.prefix === null) {
      blockList.addAddress(parsed.address, entryFamily);
    } else {
      blockList.addSubnet(parsed.address, parsed.prefix, entryFamily);
    }
    usable += 1;
  }

  // Every entry was malformed. Treating that as "unrestricted" would turn a
  // corrupted allowlist into no allowlist, which is the wrong direction.
  if (usable === 0) return false;

  return blockList.check(ip, family);
};
