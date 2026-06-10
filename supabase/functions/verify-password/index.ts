import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * Verifies a username/password pair server-side WITHOUT replacing the caller's
 * active client session.  Returns { ok: true } on success, { ok: false } on
 * bad credentials, or a 4xx/5xx on invalid input / unexpected error.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: { username?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { username, password } = body
  if (!username || !password) {
    return new Response(JSON.stringify({ ok: false, error: 'username and password are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Use a short-lived anonymous client to attempt sign-in — this does NOT
  // affect the calling user's browser session at all.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )

  const email = `${username.trim().toLowerCase()}@miaoda.com`
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Return 200 with ok:false so the caller can distinguish "wrong credentials"
    // from a real server error (which returns 5xx)
    return new Response(JSON.stringify({ ok: false, error: 'Invalid credentials' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
