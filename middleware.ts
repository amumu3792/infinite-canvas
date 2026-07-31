import { NextRequest, NextResponse } from 'next/server'

const PASS = process.env.SITE_PASS || 'i123456139'

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api')) return NextResponse.next()
  const c = req.cookies.get('gate')
  if (c && c.value === PASS) return NextResponse.next()
  return new Response('Auth Required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="My Site"' },
  })
}

export const config = { matcher: '/((?!_next|static|favicon.ico).*)' }
