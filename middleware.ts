import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  // 强制从环境变量读取，没有就拒绝所有请求
  const SITE_USER = process.env.SITE_USER
  const SITE_PASS = process.env.SITE_PASS
  
  if (!SITE_USER || !SITE_PASS) {
    return new Response('服务未正确配置', { status: 500 })
  }

  if (req.nextUrl.pathname.startsWith('/api')) return NextResponse.next()

  const auth = req.headers.get('authorization')
  if (auth && auth.startsWith('Basic ')) {
    const decoded = atob(auth.slice(6))
    const [user, pass] = decoded.split(':')
    if (user === SITE_USER && pass === SITE_PASS) {
      return NextResponse.next()
    }
  }

  return new Response('需要登录才能访问', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="请登录"' },
  })
}

export const config = {
  matcher: '/((?!_next|static|favicon.ico).*)',
}
