import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Create auth users
    const users = [
      { username: 'Admin', password: 'Admin123', full_name: 'System Administrator', role: 'Admin' },
      { username: 'Clerk1', password: 'Clerk123', full_name: 'Anniel Payne', role: 'Clerk' },
      { username: 'Clerk2', password: 'Clerk123', full_name: 'Keisha Dahlia', role: 'Clerk' },
      { username: 'Manager', password: 'Manager123', full_name: 'K. Dahlia', role: 'Admin' },
    ]

    for (const u of users) {
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: `${u.username.toLowerCase()}@miaoda.com`,
        password: u.password,
        email_confirm: true,
        user_metadata: { username: u.username, full_name: u.full_name, role: u.role },
      })

      if (authError && !authError.message.includes('already been registered')) {
        console.error(`Auth error for ${u.username}:`, authError.message)
        continue
      }

      const userId = authUser?.user?.id
      if (!userId) continue

      // Insert or update profile
      await supabase.from('profiles').upsert({
        id: userId,
        username: u.username,
        full_name: u.full_name,
        role: u.role,
      }, { onConflict: 'id' })
    }

    // Seed containers
    const { error: containerErr } = await supabase.from('containers').upsert([
      { container_id: 'BSIU1234567', vessel_name: 'Tropic Jewel', arrival_date: '2025-05-20', start_time: '08:00:00', end_time: null, status: 'In Process' },
      { container_id: 'USB001', vessel_name: 'Pacific Star', arrival_date: '2025-05-21', start_time: '09:30:00', end_time: '16:45:00', status: 'Completed' },
      { container_id: 'MSKU7890123', vessel_name: 'Atlantic Runner', arrival_date: '2025-05-22', start_time: '10:00:00', end_time: null, status: 'In Process' },
      { container_id: 'CMAU4567890', vessel_name: 'Pacific Star', arrival_date: '2025-05-23', start_time: null, end_time: null, status: 'In Process' },
      { container_id: 'HLCU9876543', vessel_name: 'Tropic Jewel', arrival_date: '2025-05-24', start_time: '07:15:00', end_time: '14:30:00', status: 'Completed' },
    ], { onConflict: 'container_id' })

    if (containerErr) console.error('Container seed error:', containerErr)

    // Seed cargo
    const { error: cargoErr } = await supabase.from('cargo').upsert([
      { cargo_id: 1, container_id: 'BSIU1234567', pallet_no: 'PLT-001', quantity: 500, commodity: 'Electronics', marks: 'FRAGILE', storage_location: 'Zone A-12', damage: 'None', remarks: 'Handle with care' },
      { cargo_id: 2, container_id: 'BSIU1234567', pallet_no: 'PLT-002', quantity: 200, commodity: 'Textiles', marks: 'KEEP DRY', storage_location: 'Zone B-05', damage: 'Water damage on 2 boxes', remarks: 'Seal compromised during transport' },
      { cargo_id: 3, container_id: 'BSIU1234567', pallet_no: 'PLT-003', quantity: 350, commodity: 'Furniture', marks: 'THIS SIDE UP', storage_location: 'Zone C-08', damage: 'None', remarks: 'Wooden crates, no issues' },
      { cargo_id: 4, container_id: 'USB001', pallet_no: 'PLT-101', quantity: 800, commodity: 'Chemicals', marks: 'HAZMAT', storage_location: 'Zone D-01', damage: 'None', remarks: 'Properly sealed containers' },
      { cargo_id: 5, container_id: 'USB001', pallet_no: 'PLT-102', quantity: 120, commodity: 'Pharmaceuticals', marks: 'COLD CHAIN', storage_location: 'Cold Storage 1', damage: 'None', remarks: 'Temperature maintained' },
      { cargo_id: 6, container_id: 'MSKU7890123', pallet_no: 'PLT-201', quantity: 600, commodity: 'Machinery Parts', marks: 'HEAVY', storage_location: 'Zone E-03', damage: 'Minor scratches on casing', remarks: 'Functional, cosmetic damage only' },
      { cargo_id: 7, container_id: 'MSKU7890123', pallet_no: 'PLT-202', quantity: 250, commodity: 'Auto Parts', marks: 'OEM', storage_location: 'Zone A-15', damage: 'None', remarks: 'Original packaging intact' },
      { cargo_id: 8, container_id: 'CMAU4567890', pallet_no: 'PLT-301', quantity: 400, commodity: 'Food Products', marks: 'BEST BEFORE 2026', storage_location: 'Cold Storage 2', damage: 'None', remarks: 'Fresh produce, expedite' },
      { cargo_id: 9, container_id: 'HLCU9876543', pallet_no: 'PLT-401', quantity: 900, commodity: 'Raw Materials', marks: 'BULK', storage_location: 'Zone F-10', damage: 'None', remarks: 'Bulk shipment completed' },
      { cargo_id: 10, container_id: 'HLCU9876543', pallet_no: 'PLT-402', quantity: 150, commodity: 'Packaging', marks: 'RECYCLE', storage_location: 'Zone G-02', damage: 'Torn wrapping on 5 units', remarks: 'Acceptable for internal use' },
    ], { onConflict: 'cargo_id' })

    if (cargoErr) console.error('Cargo seed error:', cargoErr)

    return new Response(JSON.stringify({ success: true, message: 'Data seeded successfully' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
