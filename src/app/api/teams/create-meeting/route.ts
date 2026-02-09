import { NextResponse } from 'next/server'

// Microsoft Graph API endpoints
const MS_GRAPH_AUTH_URL = 'https://login.microsoftonline.com'
const MS_GRAPH_API_URL = 'https://graph.microsoft.com/v1.0'

interface MeetingDetails {
  subject: string
  startDateTime: string // ISO format
  endDateTime: string // ISO format
  timeZone?: string
  attendees?: string[] // Email addresses of attendees
}

// Get access token using client credentials flow
async function getAccessToken(): Promise<string> {
  const tenantId = process.env.MS_TENANT_ID
  const clientId = process.env.MS_CLIENT_ID
  const clientSecret = process.env.MS_CLIENT_SECRET

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing Microsoft credentials in environment variables')
  }

  const tokenUrl = `${MS_GRAPH_AUTH_URL}/${tenantId}/oauth2/v2.0/token`

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  })

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to get access token: ${error}`)
  }

  const data = await response.json()
  return data.access_token
}

// Create Teams meeting using 3-step flow (same as cron and session-update-handler)
// Step 1: Create online meeting with organizer-only presenter + recording + lobby
// Step 2: PATCH to lock mic/camera for attendees
// Step 3: Create calendar event linked to the meeting (meeting + chat)
async function createTeamsMeeting(
  accessToken: string,
  userId: string,
  meeting: MeetingDetails
): Promise<{ joinUrl: string; meetingId: string; eventId: string | null }> {
  const start = meeting.startDateTime
  const end = meeting.endDateTime
  const subject = meeting.subject
  const attendeeEmails = meeting.attendees || []
  const timeZone = meeting.timeZone || 'Asia/Kolkata'

  // STEP 1: Create standalone online meeting
  const meetingBody = {
    subject,
    startDateTime: new Date(start).toISOString(),
    endDateTime: new Date(end).toISOString(),
    lobbyBypassSettings: { scope: 'everyone', isDialInBypassEnabled: true },
    autoAdmittedUsers: 'everyone',
    allowedPresenters: 'organizer',
    recordAutomatically: true,
    isEntryExitAnnounced: false,
    allowMeetingChat: 'enabled',
    allowTeamworkReactions: true
  }

  const meetingResponse = await fetch(`${MS_GRAPH_API_URL}/users/${userId}/onlineMeetings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(meetingBody)
  })

  if (!meetingResponse.ok) {
    const errorText = await meetingResponse.text()
    throw new Error(`Failed to create online meeting: ${errorText}`)
  }

  const meetingData = await meetingResponse.json()
  const joinUrl = meetingData.joinUrl || meetingData.joinWebUrl
  const onlineMeetingId = meetingData.id

  if (!joinUrl) {
    throw new Error('Meeting created but no join URL returned')
  }

  // STEP 2: PATCH to lock mic/camera for attendees
  try {
    await fetch(`${MS_GRAPH_API_URL}/users/${userId}/onlineMeetings/${onlineMeetingId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        allowAttendeeToEnableMic: false,
        allowAttendeeToEnableCamera: false
      })
    })
  } catch {
    // Non-fatal; meeting already created
  }

  // STEP 3: Create calendar event (meeting + chat)
  const eventBody = {
    subject,
    start: { dateTime: start, timeZone },
    end: { dateTime: end, timeZone },
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness',
    onlineMeeting: { joinUrl },
    attendees: attendeeEmails.map(email => ({
      emailAddress: { address: email },
      type: 'required'
    })),
    responseRequested: false,
    allowNewTimeProposals: false
  }

  const eventResponse = await fetch(`${MS_GRAPH_API_URL}/users/${userId}/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(eventBody)
  })

  if (!eventResponse.ok) {
    const errorText = await eventResponse.text()
    throw new Error(`Failed to create calendar event: ${errorText}`)
  }

  const eventData = await eventResponse.json()
  const eventId = eventData.id || null

  return {
    joinUrl,
    meetingId: onlineMeetingId,
    eventId
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      subject,
      startDateTime,
      endDateTime,
      timeZone = 'Asia/Kolkata',
      attendees = []
    } = body

    if (!subject || !startDateTime || !endDateTime) {
      return NextResponse.json(
        { error: 'Missing required fields: subject, startDateTime, endDateTime' },
        { status: 400 }
      )
    }

    const accessToken = await getAccessToken()

    const organizerUserId = process.env.MS_ORGANIZER_USER_ID
    if (!organizerUserId) {
      return NextResponse.json(
        { error: 'MS_ORGANIZER_USER_ID not configured' },
        { status: 500 }
      )
    }

    const result = await createTeamsMeeting(accessToken, organizerUserId, {
      subject,
      startDateTime,
      endDateTime,
      timeZone,
      attendees
    })

    return NextResponse.json({
      success: true,
      joinUrl: result.joinUrl,
      meetingId: result.meetingId,
      eventId: result.eventId,
      hasChat: true
    })
  } catch (error: any) {
    console.error('Error creating Teams meeting:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create Teams meeting' },
      { status: 500 }
    )
  }
}
