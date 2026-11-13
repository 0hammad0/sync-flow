import { formatIp, parseIp } from './ip';

/** What replaces the hidden part of a value. */
export const MASK = '•••';

/**
 * Hides the host part of an IP for roles without `ip:read`
 * (04-auth-and-security.md "Roles and permissions").
 *
 * - IPv4 keeps the /24: `203.0.113.7` → `203.0.113.•••`
 * - IPv6 keeps the /48: `2001:db8:85a3::8a2e:370:7334` → `2001:db8:85a3:•••`
 * - IPv4-mapped IPv6 is shown as IPv4. Anything unparsable → `•••`.
 */
export function maskIp(input: string | null | undefined): string {
  const ip = parseIp(input);
  if (!ip) return MASK;
  if (ip.version === 4) {
    const text = formatIp(ip);
    return `${text.slice(0, text.lastIndexOf('.'))}.${MASK}`;
  }
  const groups: string[] = [];
  for (let shift = 112; shift >= 80; shift -= 16) {
    groups.push(Number((ip.value >> BigInt(shift)) & BigInt(0xffff)).toString(16));
  }
  return `${groups.join(':')}:${MASK}`;
}
