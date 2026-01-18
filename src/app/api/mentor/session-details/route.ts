import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseB = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_B!,
  process.env.SUPABASE_SERVICE_ROLE_KEY_B!
)

// GET: Fetch session details
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tableName = searchParams.get('table')
    const date = searchParams.get('date')
    const time = searchParams.get('time')

    if (!tableName || !date) {
      return NextResponse.json({ error: 'Table and date are required' }, { status: 400 })
    }

    console.log(`Fetching session: table=${tableName}, date=${date}, time=${time}`)

    // Try to find session by date (and time if provided)
    let query = supabaseB.from(tableName).select('*').eq('date', date)
    
    if (time) {
      // Try exact match first
      query = query.eq('time', time)
    }

    const { data: sessions, error } = await query

    if (error) {
      console.error('Query error:', error)
      return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 })
    }

    // If no sessions found with exact time, get first session for that date
    let session = sessions && sessions.length > 0 ? sessions[0] : null

    if (!session && time) {
      // Retry without time filter
      const { data: dateOnlySessions } = await supabaseB
        .from(tableName)
        .select('*')
        .eq('date', date)
      
      session = dateOnlySessions && dateOnlySessions.length > 0 ? dateOnlySessions[0] : null
    }

    if (!session) {
      console.log('No session found')
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    console.log('Found session:', session.id)

    // Parse links from initial_session_material
    const initialMaterials = session.initial_session_material || ''
    const initialLinks = initialMaterials
      .split(',')
      .map((link: string) => link.trim())
      .filter((link: string) => link.length > 0)

    // Parse links from session_material
    const sessionMaterials = session.session_material || ''
    const sessionLinks = sessionMaterials
      .split(',')
      .map((link: string) => link.trim())
      .filter((link: string) => link.length > 0)

    // Merge both, avoiding duplicates
    const materialLinks = [...initialLinks]
    for (const link of sessionLinks) {
      if (!materialLinks.includes(link)) {
        materialLinks.push(link)
      }
    }

    return NextResponse.json({
      session: {
        ...session,
        materialLinks
      }
    })

  } catch (error: any) {
    console.error('Get session details error:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

// PATCH: Update session date (postpone/prepone)
export async function PATCH(request: NextRequest) {
  try {
    const { tableName, date, time, newDate, action } = await request.json()

    if (!tableName || !date || !time || !newDate) {
      return NextResponse.json(
        { error: 'Table, date, time, and newDate are required' },
        { status: 400 }
      )
    }

    // Get the new day name
    const newDateObj = new Date(newDate)
    const dayName = newDateObj.toLocaleDateString('en-US', { weekday: 'long' })

    // Update the session date
    const { data, error } = await supabaseB
      .from(tableName)
      .update({ 
        date: newDate,
        day: dayName,
        // Clear the meeting link since date changed
        teams_meeting_link: null
      })
      .eq('date', date)
      .eq('time', time)
      .select()
      .single()

    if (error) {
      console.error('Update session error:', error)
      return NextResponse.json({ error: 'Failed to update session' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `Session ${action || 'moved'} to ${newDate}`,
      session: data
    })

  } catch (error: any) {
    console.error('Update session error:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

