import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, readSessionToken } from "@/lib/session-token";

const PUBLIC_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await readSessionToken(token) : null;
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (!session && !isPublic && pathname !== "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    if (pathname.startsWith("/") && !pathname.startsWith("//")) {
      url.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(url);
  }

  if (session && (pathname === "/" || pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
