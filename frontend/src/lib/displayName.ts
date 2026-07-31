/**
 * Display-name helpers.
 *
 * The SWA principal's `userDetails` is the UPN (e.g. mike.hobson@codestone.com).
 * Until the API returns a richer profile we derive a human-readable name
 * from it. When /api/me starts returning a proper display name, prefer that.
 */

export function nameFromUpn(upn: string): string {
  const localPart = upn.split('@')[0] ?? upn;
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
