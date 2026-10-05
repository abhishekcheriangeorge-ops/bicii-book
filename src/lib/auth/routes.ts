/**
 * Which paths are open to signed-out visitors. Everything else is a staff
 * route: proxy.ts sends signed-out requests for it to /login (an
 * optimisation only; every page and action still calls requireStaff()).
 */
const PUBLIC_PREFIXES = ["/login", "/dev/", "/api/health"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`),
  );
}
