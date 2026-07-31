import { NextRequest, NextResponse } from 'next/server';

const BASIC_USER = process.env.SITE_USER || '';
const BASIC_PASS = process.env.SITE_PASS || '';

export function middleware(req: NextRequest) {
  // 没配环境变量就别拦了，避免锁死自己
  if (!BASIC_USER || !BASIC_PASS) {
    return NextResponse.next();
  }

  // API 路由放行，保证你之前加的 AI 代理能用
  if (req.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const [u, p] = decoded.split(':');
    if (u === BASIC_USER && p === BASIC_PASS) {
      return NextResponse.next();
    }
  }

  return new Response('Auth Required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Secure Area"' },
  });
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
