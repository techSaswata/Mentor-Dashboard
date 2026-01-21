import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// POST /api/session/swap-mentor - Swap mentor for a session
export async function POST(request: NextRequest) {
  try {
    const { tableName, sessionId, swappedMentorId, swappedByName } = await request.json()

    if (!tableName || !sessionId) {
      return NextResponse.json(
        { error: 'Missing required fields: tableName, sessionId' },
        { status: 400 }
      )
    }

    // Initialize Supabase clients
    const supabaseB = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL_B!,
      process.env.SUPABASE_SERVICE_ROLE_KEY_B!
    )

    // Fetch session details before update
    const { data: session, error: sessionError } = await supabaseB
      .from(tableName)
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    // Store old swapped mentor ID for notifications
    const oldSwappedMentorId = session.swapped_mentor_id

    // ============ CHECK FOR SCHEDULE CONFLICTS ============
    if (swappedMentorId) {
      const sessionDate = session.date
      const sessionTime = session.time

      // Get all schedule tables
      const { data: tables, error: tablesError } = await supabaseB.rpc('get_schedule_tables')

      if (!tablesError && tables && tables.length > 0) {
        console.log(`Checking ${tables.length} tables for conflicts...`)

        for (const table of tables) {
          const checkTableName = table.table_name

          // Query for any session where this mentor (original or swapped) has a class at same date-time
          const { data: conflicts, error: conflictError } = await supabaseB
            .from(checkTableName)
            .select('id, subject_name, mentor_id, swapped_mentor_id')
            .eq('date', sessionDate)
            .eq('time', sessionTime)

          if (conflictError) {
            console.error(`Error checking conflicts in ${checkTableName}:`, conflictError)
            continue
          }

          if (conflicts && conflicts.length > 0) {
            // Check if swappedMentorId is either the original or swapped mentor in any of these sessions
            for (const conflict of conflicts) {
              // Skip if it's the same session we're trying to swap
              if (checkTableName === tableName && conflict.id === sessionId) {
                continue
              }

              const isOriginalMentor = conflict.mentor_id === swappedMentorId
              const isSwappedMentor = conflict.swapped_mentor_id === swappedMentorId

              // If mentor is original but has been swapped away, they're free
              const isSwappedAway = isOriginalMentor && conflict.swapped_mentor_id !== null

              if ((isOriginalMentor && !isSwappedAway) || isSwappedMentor) {
                // Format batch name from table name
                const batchMatch = checkTableName.match(/^([a-zA-Z]+)(\d+)_(\d+)_schedule$/)
                const batchName = batchMatch 
                  ? `${batchMatch[1].charAt(0).toUpperCase() + batchMatch[1].slice(1)} ${batchMatch[2]}.${batchMatch[3]}`
                  : checkTableName.replace('_schedule', '')

                console.log(`Conflict found for mentor ${swappedMentorId}: ${batchName} - ${conflict.subject_name}`)
                
                // Block the swap - return error with conflict details
                return NextResponse.json(
                  { 
                    error: `Schedule conflict! This mentor already has a class at the same time: ${batchName} - ${conflict.subject_name || 'Session'}`,
                    hasConflict: true,
                    conflictDetails: [{
                      tableName: checkTableName,
                      batchName,
                      subjectName: conflict.subject_name || 'Session'
                    }]
                  },
                  { status: 409 } // 409 Conflict
                )
              }
            }
          }
        }
      }
    }

    // Step 1: Update the swapped_mentor_id in database
    const { error: updateError } = await supabaseB
      .from(tableName)
      .update({ swapped_mentor_id: swappedMentorId || null })
      .eq('id', sessionId)

    if (updateError) {
      console.error('Error updating swapped mentor:', updateError)
      return NextResponse.json(
        { error: 'Failed to update mentor' },
        { status: 500 }
      )
    }

    console.log(`Mentor swap ${swappedMentorId ? 'set' : 'removed'} for session ${sessionId}`)

    // Step 2: Call session-update endpoint to handle meeting regeneration and notifications
    // This endpoint handles:
    // - Deleting old Teams meeting (if exists)
    // - Creating new Teams meeting with proper settings (lobby bypass, auto-recording, mic/camera restrictions)
    // - Sending notifications to students, mentors (original + new), supermentors
    // - Resetting email_sent and whatsapp_sent flags
    
    let sessionUpdateResult = null
    
    if (swappedMentorId) {
      // Only call session-update when swapping TO a mentor (not when removing swap)
      // Use request origin to get the correct port (handles dev server port changes)
      const baseUrl = request.nextUrl.origin
      
      const sessionUpdateResponse = await fetch(
        `${baseUrl}/api/cohort/session-update`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableName,
            sessionId,
            oldDate: session.date,
            oldTime: session.time,
            newDate: session.date,
            newTime: session.time,
            changedField: 'swapped_mentor_id', // Indicates this is a swap
            oldMentorId: oldSwappedMentorId || session.mentor_id, // Previous mentor
            newMentorId: swappedMentorId, // New mentor
            skipMeetingRegeneration: !session.teams_meeting_link // Only regenerate if meeting exists
          })
        }
      )

      if (sessionUpdateResponse.ok) {
        sessionUpdateResult = await sessionUpdateResponse.json()
        console.log('Session update handler result:', sessionUpdateResult)
      } else {
        const errorText = await sessionUpdateResponse.text()
        console.error('Session update handler failed:', errorText)
      }
    } else {
      // When removing swap, just reset notification flags if meeting link changed
      console.log('Swap removed - notifications will be handled by daily scheduler')
    }

    return NextResponse.json({ 
      success: true, 
      message: swappedMentorId ? 'Mentor swapped successfully' : 'Mentor swap removed',
      newMeetingLink: sessionUpdateResult?.results?.newMeetingLink,
      notifications: sessionUpdateResult?.results?.notificationsSent || { skipped: true }
    })

  } catch (error: any) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: error.message || 'An error occurred' },
      { status: 500 }
    )
  }
}
