import { protectedResourceHandler, getPublicOrigin, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { resourceUrl } from "@/lib/oauth/config";

// RFC 9728 Protected Resource Metadata (issue #151). Tells an MCP client which
// Authorization Server protects /api/mcp/sse — here aido itself (the AS issuer
// is the public origin). Built per request so the origin is correct behind the
// Vercel proxy.

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const origin = getPublicOrigin(req);
  return protectedResourceHandler({
    authServerUrls: [origin],
    resourceUrl: resourceUrl(origin),
  })(req);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
