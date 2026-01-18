import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseB = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_B!,
  process.env.SUPABASE_SERVICE_ROLE_KEY_B!
)

export async function POST(request: NextRequest) {
  try {
    const { tableName, sessionId, date, time, newLinks, mentorId } = await request.json()

    if (!tableName || !newLinks || newLinks.length === 0) {
      return NextResponse.json(
        { error: 'Table name and links are required' },
        { status: 400 }
      )
    }

    // First, fetch the current session to get existing session_material
    let query = supabaseB.from(tableName).select('session_material, id, date, time')

    // Build query based on available identifiers
    if (sessionId) {
      query = query.eq('id', sessionId)
    } else if (date && time) {
      query = query.eq('date', date).eq('time', time)
    } else if (date && mentorId) {
      query = query.eq('date', date).eq('mentor_id', mentorId)
    } else {
      return NextResponse.json(
        { error: 'Session identifier required (id, or date+time, or date+mentorId)' },
        { status: 400 }
      )
    }

    const { data: session, error: fetchError } = await query.single()

    if (fetchError) {
      console.error('Error fetching session:', fetchError)
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    // Get existing session_material and append new ones
    const existingMaterials = session.session_material || ''
    const existingLinks = existingMaterials
      .split(',')
      .map((link: string) => link.trim())
      .filter((link: string) => link.length > 0)

    // Add new links (avoid duplicates)
    const allLinks = [...existingLinks]
    for (const newLink of newLinks) {
      const trimmedLink = newLink.trim()
      if (trimmedLink && !allLinks.includes(trimmedLink)) {
        allLinks.push(trimmedLink)
      }
    }

    const updatedMaterials = allLinks.join(', ')

    // Update session_material column only
    let updateQuery = supabaseB
      .from(tableName)
      .update({ session_material: updatedMaterials })

    if (sessionId) {
      updateQuery = updateQuery.eq('id', sessionId)
    } else if (date && time) {
      updateQuery = updateQuery.eq('date', date).eq('time', time)
    } else if (date && mentorId) {
      updateQuery = updateQuery.eq('date', date).eq('mentor_id', mentorId)
    }

    const { error: updateError } = await updateQuery

    if (updateError) {
      console.error('Error updating session material:', updateError)
      return NextResponse.json(
        { error: 'Failed to update session material' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Session material updated successfully',
      materials: updatedMaterials,
      linkCount: allLinks.length
    })

  } catch (error: any) {
    console.error('Update session material error:', error)
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    )
  }
}

// GET endpoint to fetch current materials for a session (from both columns)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tableName = searchParams.get('table')
    const date = searchParams.get('date')
    const time = searchParams.get('time')
    const mentorId = searchParams.get('mentor_id')

    if (!tableName) {
      return NextResponse.json({ error: 'Table name is required' }, { status: 400 })
    }

    // Fetch both initial_session_material and session_material
    let query = supabaseB.from(tableName).select('initial_session_material, session_material, id')

    if (date && time) {
      query = query.eq('date', date).eq('time', time)
    } else if (date && mentorId) {
      query = query.eq('date', date).eq('mentor_id', parseInt(mentorId))
    } else {
      return NextResponse.json({ error: 'Date and time/mentorId required' }, { status: 400 })
    }

    const { data: session, error } = await query.single()

    if (error) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

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
    const allLinks = [...initialLinks]
    for (const link of sessionLinks) {
      if (!allLinks.includes(link)) {
        allLinks.push(link)
      }
    }

    return NextResponse.json({
      materials: allLinks.join(', '),
      links: allLinks,
      linkCount: allLinks.length,
      initialLinks,
      sessionLinks
    })

  } catch (error: any) {
    console.error('Fetch session material error:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

// PUT endpoint to delete a specific material link from the appropriate column
export async function PUT(request: NextRequest) {
  try {
    const { tableName, date, time, linkToDelete } = await request.json()

    if (!tableName || !date || !time || !linkToDelete) {
      return NextResponse.json(
        { error: 'Table name, date, time, and linkToDelete are required' },
        { status: 400 }
      )
    }

    // Fetch both columns to check where the link exists
    const { data: session, error: fetchError } = await supabaseB
      .from(tableName)
      .select('initial_session_material, session_material')
      .eq('date', date)
      .eq('time', time)
      .single()

    if (fetchError) {
      console.error('Error fetching session:', fetchError)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

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

    // Check which column contains the link and remove from appropriate one
    const updateData: Record<string, string> = {}
    let deletedFrom = ''

    if (initialLinks.includes(linkToDelete)) {
      // Remove from initial_session_material
      const updatedInitialLinks = initialLinks.filter(link => link !== linkToDelete)
      updateData.initial_session_material = updatedInitialLinks.join(', ')
      deletedFrom = 'initial_session_material'
    } else if (sessionLinks.includes(linkToDelete)) {
      // Remove from session_material
      const updatedSessionLinks = sessionLinks.filter(link => link !== linkToDelete)
      updateData.session_material = updatedSessionLinks.join(', ')
      deletedFrom = 'session_material'
    } else {
      return NextResponse.json({ error: 'Link not found in any column' }, { status: 404 })
    }

    // Update the appropriate column
    const { error: updateError } = await supabaseB
      .from(tableName)
      .update(updateData)
      .eq('date', date)
      .eq('time', time)

    if (updateError) {
      console.error('Error updating session material:', updateError)
      return NextResponse.json(
        { error: 'Failed to delete session material' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Session material deleted successfully',
      deletedFrom
    })

  } catch (error: any) {
    console.error('Delete session material error:', error)
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    )
  }
}
