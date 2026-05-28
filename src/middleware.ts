import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { hasAuthCookie, userIdFromNextRequest } from '@/lib/supabase/request-auth'

/** Routes that authenticate inside the handler — skip Supabase in middleware. */
function skipsMiddlewareAuth(pathname: string): boolean {
  if (pathname.startsWith('/api/inbox/')) return true
  if (pathname.startsWith('/api/automations/cron')) return true
  if (pathname.startsWith('/api/whatsapp/') && pathname.includes('/webhook')) return true
  return false
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  if (skipsMiddlewareAuth(pathname)) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })
  const cookieList = request.cookies.getAll()
  const hasCookie = hasAuthCookie(cookieList)

  // Fast path: read user id from JWT in cookie (no Auth API call).
  let user: { id: string } | null = null
  const userIdFromCookie = userIdFromNextRequest(request)
  if (userIdFromCookie) {
    user = { id: userIdFromCookie }
  } else if (hasCookie) {
    // Cookie present but unreadable — try getSession without forcing getUser.
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options),
            )
          },
        },
      },
    )

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) user = session.user
    } catch (err) {
      console.error('[middleware] supabase getSession failed:', err)
      // If auth cookie exists, allow page through; API routes verify separately.
      if (hasCookie && pathname.startsWith('/api/')) {
        return supabaseResponse
      }
    }
  }

  // Auth pages - redirect to dashboard if already logged in
  if (user && (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = [
    '/dashboard',
    '/inbox',
    '/contacts',
    '/pipelines',
    '/broadcasts',
    '/automations',
    '/ai-agents',
    '/settings',
  ]
  if (!user && !hasCookie && protectedPaths.some((path) => pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // API routes that need auth (not webhooks / external notification API)
  if (
    !user &&
    !hasCookie &&
    pathname.startsWith('/api/whatsapp/') &&
    !pathname.includes('/webhook')
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!user && !hasCookie && pathname.startsWith('/api/ai/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!user && pathname.startsWith('/api/v1/')) {
    return supabaseResponse
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
