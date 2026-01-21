import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    const { 
      tableName, 
      sessionId, 
      originalDate,
      originalTime,
      newDate, 
      newTime, 
      actionType,
      mentorName 
    } = await request.json()

    if (!tableName || !sessionId || !newDate || !actionType) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Initialize Supabase client for DB B (schedule tables)
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

    // Get day name for new date
    const dateObj = new Date(newDate + 'T12:00:00')
    const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const newDayName = DAYS_OF_WEEK[dateObj.getDay()]

    // Step 1: Update session in database (date, day, time)
    const updateData: Record<string, any> = {
      date: newDate,
      day: newDayName
    }

    if (newTime) {
      updateData.time = newTime
    }

    const { error: updateError } = await supabaseB
      .from(tableName)
      .update(updateData)
      .eq('id', sessionId)

    if (updateError) {
      throw new Error('Failed to update session: ' + updateError.message)
    }

    console.log(`Session ${sessionId} ${actionType}d: ${originalDate} -> ${newDate}`)

    // Step 2: Call session-update endpoint to handle meeting regeneration and notifications
    // This endpoint handles:
    // - Deleting old Teams meeting
    // - Creating new Teams meeting with proper settings (lobby bypass, auto-recording, mic/camera restrictions)
    // - Sending notifications to students, mentors, supermentors
    // - Resetting email_sent and whatsapp_sent flags
    
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
          oldDate: originalDate || session.date,
          oldTime: originalTime || session.time,
          newDate,
          newTime: newTime || session.time,
          changedField: 'date', // Indicates this is a reschedule
          skipMeetingRegeneration: false
        })
      }
    )

    let sessionUpdateResult = null
    if (sessionUpdateResponse.ok) {
      sessionUpdateResult = await sessionUpdateResponse.json()
      console.log('Session update handler result:', sessionUpdateResult)
    } else {
      const errorText = await sessionUpdateResponse.text()
      console.error('Session update handler failed:', errorText)
    }

    return NextResponse.json({
      success: true,
      message: `Session ${actionType}d successfully`,
      newMeetingLink: sessionUpdateResult?.results?.newMeetingLink,
      notifications: sessionUpdateResult?.results?.notificationsSent || { skipped: true }
    })

  } catch (error: any) {
    console.error('Reschedule error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to reschedule session' },
      { status: 500 }
    )
  }
}
