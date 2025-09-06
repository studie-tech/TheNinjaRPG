import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
// import type { NextRequest } from "next/server";
// import * as UAParser from "ua-parser-js";

const isPublicRoute = createRouteMatcher([
  "/(.*)",
  "/api/cleaner",
  "/api/daily",
  "/api/healthcheck",
  "/api/ipn",
  "/api/subscriptions",
  "/api/trpc/(.*)",
  "/api/uploadthing",
  "/conceptart(.*)",
  "/forum(.*)",
  "/github",
  "/help",
  "/login(.*)",
  "/manual(.*)",
  "/news",
  "/rules",
]);

// export function uaMiddleware(request: NextRequest) {
//   const userAgent = request.headers.get("user-agent") || undefined;
//   const userAgentParsed = new UAParser.UAParser(userAgent);
//   if (userAgentParsed.getBrowser().name === undefined) {
//     return NextResponse.json(
//       { message: "Forbidden. Only access through browser" },
//       { status: 403 },
//     );
//   }
//   return NextResponse.next();
// }

export default clerkMiddleware(
  async (auth, request) => {
    // Protect all routes except for the public ones
    if (!isPublicRoute(request)) {
      await auth.protect();
    }
    // Ensure valid user agent
    // return uaMiddleware(request);
    // A/B test: landing page split between welcome-old and welcome-new (only for signed-out users)
    const { pathname } = request.nextUrl;
    const { userId } = await auth();
    if (pathname === "/" && !userId) {
      const cookie = request.cookies.get("ab_welcome_variantion");
      const variant = cookie?.value ?? (Math.random() < 0.5 ? "treatment" : "control");
      const url = request.nextUrl.clone();
      url.pathname = variant === "treatment" ? "/welcome-new" : "/welcome-old";
      console.log("variant", variant);
      const res = NextResponse.rewrite(url);
      if (!cookie) res.cookies.set("ab_welcome_variantion", variant, { path: "/" });
      return res;
    }
  },
  { clockSkewInMs: 1000 * 60 * 30 },
);

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next
     * - static (static files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/(.*?trpc.*?|.*?api.*?|(?!static|.*\\..*|_next|favicon.ico).*)",
    "/",
  ],
};
