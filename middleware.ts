import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const SITE_USER = process.env.SITE_USER;
  const SITE_PASS = process.env.SITE_PASS;

  // 强制校验：如果没有配置环境变量，直接拦截
  if (!SITE_USER || !SITE_PASS) {
    return new NextResponse('Server configuration error', { status: 500 });
  }

  // API 接口放行，不需要密码
  if (req.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Basic ')) {
    const encoded = authHeader.slice(6);
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      const [user, pass] = decoded.split(':');
      if (user === SITE_USER && pass === SITE_PASS) {
        return NextResponse.next();
      }
    } catch (e) {
      // 解码失败，视为未授权
    }
  }

  // 未通过验证，弹出浏览器自带的登录框
  return new NextResponse('Authentication Required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"'
    },
  });
}

// 配置匹配规则：除了 _next, static, favicon 等静态资源，其他都走中间件
export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
