const contentSecurityPolicy = (request: Request): string => {
  const url = new URL(request.url);
  const webSocketOrigin = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
  return [
    "default-src 'self'",
    "base-uri 'none'",
    `connect-src 'self' ${webSocketOrigin}`,
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "manifest-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "worker-src 'self'",
  ].join('; ');
};

export const withSecurityHeaders = (request: Request, response: Response): Response => {
  const secured = new Response(response.body, response);
  secured.headers.set('content-security-policy', contentSecurityPolicy(request));
  secured.headers.set('cross-origin-opener-policy', 'same-origin');
  secured.headers.set('cross-origin-resource-policy', 'same-origin');
  secured.headers.set('permissions-policy', 'camera=(), geolocation=(), microphone=()');
  secured.headers.set('referrer-policy', 'no-referrer');
  secured.headers.set('x-content-type-options', 'nosniff');
  secured.headers.set('x-frame-options', 'DENY');
  secured.headers.set('x-permitted-cross-domain-policies', 'none');
  if (new URL(request.url).protocol === 'https:') {
    secured.headers.set('strict-transport-security', 'max-age=31536000');
  }
  return secured;
};
