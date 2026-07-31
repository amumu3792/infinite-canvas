import { NextRequest, NextResponse } from 'next/server'

// 👇 这里设置你固定的用户名和密码（改成你自己的）
const FIXED_USER = 'admin'
const FIXED_PASS = 'i123456139'

export function middleware(req: NextRequest) {
  // 放过 API 路由，不影响你 AI 绘图的功能
  if (req.nextUrl.pathname.startsWith('/api')) return NextResponse.next()

  // 读取 Basic Auth 的认证头
  const auth = req.headers.get('authorization')
  if (auth && auth.startsWith('Basic ')) {
    const decoded = atob(auth.slice(6))
    const [user, pass] = decoded.split(':')

    // 用户名和密码都必须匹配
    if (user === FIXED_USER && pass === FIXED_PASS) {
      return NextResponse.next()
    }
  }

  // 认证失败，弹窗要求输入
  return new Response('需要登录才能访问', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="请使用管理员账号登录"',
    },
  })
}

export const config = {
  matcher: '/((?!_next|static|favicon.ico).*)',
}
