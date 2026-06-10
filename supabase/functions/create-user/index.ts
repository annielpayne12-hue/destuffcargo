import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '*'
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

const VALID_ROLES = ['Admin', 'Manager', 'Supervisor', 'Clerk', 'Data Entry Clerk', 'Shipping Agent']
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/

function validatePassword(password: string): { valid: boolean; message?: string } {
  if (!password || password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters' }
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' }
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' }
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' }
  }
  return { valid: true }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verify the caller is authenticated and has admin/manager role
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'Unauthorized: missing authorization header' }, 401)
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: authHeader } },
      }
    )

    const { data: { user }, error: authErr } = await supabaseClient.auth.getUser()
    if (authErr || !user) {
      return jsonResponse({ error: 'Unauthorized: invalid token' }, 401)
    }

    // Check caller role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile || !['Admin', 'Manager'].includes(profile.role)) {
      return jsonResponse({ error: 'Forbidden: only Admin or Manager can create users' }, 403)
    }

    const body = await req.json()
    const { username, password, full_name, role } = body

    // Validate required fields
    if (!username || !password || !role) {
      return jsonResponse({ error: 'Username, password, and role are required' }, 400)
    }

    // Validate username format
    if (!USERNAME_REGEX.test(username)) {
      return jsonResponse({ error: 'Username must be 3-30 characters, alphanumeric and underscores only' }, 400)
    }

    // Validate role
    if (!VALID_ROLES.includes(role)) {
      return jsonResponse({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }, 400)
    }

    // Validate password strength
    const pwCheck = validatePassword(password)
    if (!pwCheck.valid) {
      return jsonResponse({ error: pwCheck.message }, 400)
    }

    // Check for duplicate username
    const { data: existing } = await supabase
      .from('profiles')
      .select('username')
      .eq('username', username.trim())
      .maybeSingle()

    if (existing) {
      return jsonResponse({ error: 'Username already exists' }, 409)
    }

    const email = `${username.toLowerCase()}@miaoda.com`

    // Check for duplicate email in auth.users
    const { data: existingAuth } = await supabase.auth.admin.listUsers()
    const emailExists = existingAuth?.users?.some((u: any) => u.email === email)
    if (emailExists) {
      return jsonResponse({ error: 'Username already exists' }, 409)
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: username.trim(), full_name: full_name?.trim(), role },
    })

    if (authError) {
      return jsonResponse({ error: authError.message }, 400)
    }

    if (authData.user) {
      await supabase.from('profiles').insert({
        id: authData.user.id,
        username: username.trim(),
        full_name: full_name?.trim() || null,
        role,
      })
    }

    return jsonResponse({ success: true, userId: authData.user?.id }, 200)
  } catch (error: any) {
    console.error('create-user error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})
