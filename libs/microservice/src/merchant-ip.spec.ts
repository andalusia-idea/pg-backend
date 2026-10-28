import { describe, expect, it } from '@jest/globals';
import { isIpAllowed, isValidIpAllowlistEntry } from './merchant-ip';

describe('isValidIpAllowlistEntry', () => {
  it.each([
    ['bare IPv4', '203.0.113.5'],
    ['IPv4 CIDR', '198.51.100.0/24'],
    ['IPv4 single-host CIDR', '203.0.113.5/32'],
    ['bare IPv6', '2001:db8::1'],
    ['IPv6 CIDR', '2001:db8::/32'],
  ])('accepts %s', (_label, entry) => {
    expect(isValidIpAllowlistEntry(entry)).toBe(true);
  });

  it.each([
    ['a hostname', 'merchant.example.com'],
    ['a wildcard', '203.0.113.*'],
    ['an out-of-range octet', '203.0.113.999'],
    ['an IPv4 prefix above 32', '198.51.100.0/33'],
    ['an IPv6 prefix above 128', '2001:db8::/129'],
    ['a negative prefix', '198.51.100.0/-1'],
    ['a non-numeric prefix', '198.51.100.0/abc'],
    ['a doubled prefix', '198.51.100.0/24/24'],
    ['empty', ''],
  ])('rejects %s', (_label, entry) => {
    expect(isValidIpAllowlistEntry(entry)).toBe(false);
  });
});

describe('isIpAllowed', () => {
  /** The feature is opt-in: most merchants never set one. */
  it('allows anything when the list is empty', () => {
    expect(isIpAllowed('203.0.113.5', [])).toBe(true);
    expect(isIpAllowed(null, [])).toBe(true);
  });

  it('matches a bare address', () => {
    expect(isIpAllowed('203.0.113.5', ['203.0.113.5'])).toBe(true);
    expect(isIpAllowed('203.0.113.6', ['203.0.113.5'])).toBe(false);
  });

  it('matches inside a CIDR range', () => {
    expect(isIpAllowed('198.51.100.77', ['198.51.100.0/24'])).toBe(true);
    expect(isIpAllowed('198.51.101.1', ['198.51.100.0/24'])).toBe(false);
  });

  it('matches against any entry in the list', () => {
    const list = ['203.0.113.5', '198.51.100.0/24', '2001:db8::/32'];

    expect(isIpAllowed('203.0.113.5', list)).toBe(true);
    expect(isIpAllowed('198.51.100.9', list)).toBe(true);
    expect(isIpAllowed('2001:db8::abcd', list)).toBe(true);
    expect(isIpAllowed('192.0.2.1', list)).toBe(false);
  });

  /** Proxies commonly present an IPv4 client in this form. */
  it('matches an IPv4-mapped IPv6 address against an IPv4 entry', () => {
    expect(isIpAllowed('::ffff:203.0.113.5', ['203.0.113.5'])).toBe(true);
    expect(isIpAllowed('::ffff:198.51.100.9', ['198.51.100.0/24'])).toBe(true);
  });

  /**
   * The failure direction that matters. A merchant with an allowlist whose
   * origin cannot be resolved - the shape a misconfigured `trustProxy` takes -
   * must be rejected, never waved through.
   */
  it.each([[null], [undefined], ['']])(
    'rejects an unresolvable origin (%s) when a list is configured',
    (ip) => {
      expect(isIpAllowed(ip, ['203.0.113.5'])).toBe(false);
    },
  );

  it('rejects an origin that is not an IP address at all', () => {
    expect(isIpAllowed('not-an-ip', ['203.0.113.5'])).toBe(false);
  });

  /** Skipping a bad entry narrows the list, so it can lock a merchant out
   * but can never let a stranger in. */
  it('ignores a malformed entry while honouring the valid ones', () => {
    const list = ['not-an-ip', '203.0.113.5'];

    expect(isIpAllowed('203.0.113.5', list)).toBe(true);
    expect(isIpAllowed('192.0.2.1', list)).toBe(false);
  });

  /** A wholly corrupted list must not degrade into "no restriction". */
  it('rejects everything when no entry is usable', () => {
    expect(isIpAllowed('203.0.113.5', ['not-an-ip', 'also-bad'])).toBe(false);
  });
});
