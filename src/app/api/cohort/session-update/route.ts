import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail, generateStudentEmailHTML } from '@/lib/email'

// Microsoft Graph API configuration
const MS_GRAPH_AUTH_URL = 'https://login.microsoftonline.com'
const MS_GRAPH_API_URL = 'https://graph.microsoft.com/v1.0'

// WhatsApp configuration
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const WHATSAPP_UPDATE_TEMPLATE = process.env.WHATSAPP_UPDATE_TEMPLATE || 'class_rescheduled'

// Format phone number for WhatsApp
function formatPhoneForWhatsApp(phone: string | number | null | undefined): string | null {
  if (!phone) return null
  
  let phoneStr = String(phone).replace(/\D/g, '')
  
  if (phoneStr.length === 10) {
    phoneStr = '91' + phoneStr
  }
  
  if (phoneStr.length >= 10 && phoneStr.length <= 15) {
    return phoneStr
  }
  
  return null
}

// Send WhatsApp message
async function sendWhatsAppMessage(params: {
  to: string
  recipientName: string
  cohortType: string
  cohortNumber: string
  oldDate: string
  oldTime: string
  newDate: string
  newTime: string
  subjectName: string
  meetingLink?: string | null
}): Promise<boolean> {
  if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
    console.log('WhatsApp not configured, skipping')
    return false
  }

  try {
    // Build template parameters - include meeting link if available
    const bodyParams: any[] = [
      { type: 'text', text: params.recipientName },
      { type: 'text', text: `${params.cohortType} ${params.cohortNumber}` },
      { type: 'text', text: params.oldDate },
      { type: 'text', text: params.oldTime },
      { type: 'text', text: params.newDate },
      { type: 'text', text: params.newTime },
      { type: 'text', text: params.subjectName }
    ]
    
    // Add meeting link if available (template must support 8th parameter)
    if (params.meetingLink) {
      bodyParams.push({ type: 'text', text: params.meetingLink })
    }

    const response = await fetch(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: params.to,
          type: 'template',
          template: {
            name: WHATSAPP_UPDATE_TEMPLATE,
            language: { code: 'en' },
            components: [
              {
                type: 'body',
                parameters: bodyParams
              }
            ]
          }
        })
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('WhatsApp send failed:', errorText)
      return false
    }

    return true
  } catch (error) {
    console.error('WhatsApp error:', error)
    return false
  }
}

// Get access token for MS Graph
async function getAccessToken(): Promise<string> {
  const tenantId = process.env.MS_TENANT_ID
  const clientId = process.env.MS_CLIENT_ID
  const clientSecret = process.env.MS_CLIENT_SECRET

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing Microsoft credentials')
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
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  })

  if (!response.ok) {
    throw new Error(`Failed to get access token: ${await response.text()}`)
  }

  const data = await response.json()
  return data.access_token
}

// Extract meeting thread ID from Teams URL (handles URL-encoded and decoded formats)
function extractMeetingThreadId(url: string): string | null {
  if (!url) return null
  
  try {
    // Decode URL to handle %3a, %40, etc.
    let decoded = url
    try {
      decoded = decodeURIComponent(url)
    } catch {
      // Already decoded or invalid encoding
    }
    
    // Match pattern: 19:meeting_XXXX@thread.v2
    const match = decoded.match(/19:meeting_[a-zA-Z0-9_-]+@thread\.v2/)
    return match ? match[0] : null
  } catch {
    return null
  }
}

// Delete a Teams meeting by finding the calendar event with that join URL
async function deleteTeamsMeeting(accessToken: string, meetingLink: string): Promise<boolean> {
  const organizerUserId = process.env.MS_ORGANIZER_USER_ID
  if (!organizerUserId) {
    console.log('MS_ORGANIZER_USER_ID not configured, skipping meeting deletion')
    return false
  }

  try {
    // Extract meeting ID from stored link for comparison
    const storedMeetingId = extractMeetingThreadId(meetingLink)
    console.log(`  Looking for meeting with thread ID: ${storedMeetingId}`)
    
    if (!storedMeetingId) {
      console.log('  Could not extract meeting ID from stored link, trying direct match...')
    }

    // Search for calendar events - use /events endpoint (not calendarView)
    // calendarView doesn't return onlineMeeting details properly
    // Get all recent events and filter by online meeting in code
    const url = `${MS_GRAPH_API_URL}/users/${organizerUserId}/events?$select=id,subject,isOnlineMeeting,onlineMeeting&$top=200&$orderby=start/dateTime desc`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      console.log('Could not search calendar events:', await response.text())
      return false
    }

    const data = await response.json()
    const events = data.value || []
    
    console.log(`  Found ${events.length} calendar events to search`)

    // Find matching event - compare by meeting thread ID (handles encoding differences)
    const matchingEvent = events.find((event: any) => {
      if (!event.onlineMeeting?.joinUrl) return false
      
      const eventJoinUrl = event.onlineMeeting.joinUrl
      
      // First try exact match
      if (eventJoinUrl === meetingLink) {
        console.log(`  ✓ Exact match found: ${event.subject}`)
        return true
      }
      
      // Then try meeting ID comparison (handles URL encoding differences)
      if (storedMeetingId) {
        const eventMeetingId = extractMeetingThreadId(eventJoinUrl)
        if (eventMeetingId === storedMeetingId) {
          console.log(`  ✓ Thread ID match found: ${event.subject}`)
          return true
        }
      }
      
      return false
    })
    
    // Debug: If not found, show what's in the events
    if (!matchingEvent && events.length > 0) {
      console.log(`  Debug - Looking for: ${storedMeetingId}`)
      console.log(`  Debug - First 3 events:`)
      events.slice(0, 3).forEach((event: any, i: number) => {
        const hasOnlineMeeting = !!event.onlineMeeting
        const joinUrl = event.onlineMeeting?.joinUrl
        const tid = joinUrl ? extractMeetingThreadId(joinUrl) : 'NO_URL'
        console.log(`    ${i + 1}. "${event.subject}" | hasOnlineMeeting: ${hasOnlineMeeting} | threadId: ${tid}`)
      })
    }

    if (matchingEvent) {
      // Delete the calendar event (this also cancels the meeting)
      const deleteUrl = `${MS_GRAPH_API_URL}/users/${organizerUserId}/events/${matchingEvent.id}`
      const deleteResponse = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })

      if (deleteResponse.ok || deleteResponse.status === 204) {
        console.log(`  Deleted meeting: ${matchingEvent.subject}`)
        return true
      } else {
        console.log('Could not delete meeting:', await deleteResponse.text())
      }
    } else {
      console.log('  Meeting event not found in calendar, skipping deletion')
    }

    return false
  } catch (error) {
    console.error('Error deleting meeting:', error)
    return false
  }
}

// Create Teams meeting with full settings (3-step approach)
// Step 1: Create standalone online meeting with lobby bypass + auto-recording
// Step 2: PATCH to disable attendee mic/camera
// Step 3: Create calendar event linked to the meeting
async function createTeamsMeeting(
  accessToken: string,
  subject: string,
  startDateTime: string,  // Format: YYYY-MM-DDTHH:MM:SS
  endDateTime: string,    // Format: YYYY-MM-DDTHH:MM:SS
  attendeeEmails: string[] = []
): Promise<string | null> {
  const organizerUserId = process.env.MS_ORGANIZER_USER_ID
  if (!organizerUserId) {
    throw new Error('MS_ORGANIZER_USER_ID not configured')
  }

  console.log(`  Creating meeting: ${subject}`)
  console.log(`  Start: ${startDateTime}, End: ${endDateTime}`)

  // STEP 1: Create standalone online meeting with lobby bypass + auto-recording + organizer-only presenter
  const meetingBody = {
    subject,
    startDateTime: new Date(startDateTime).toISOString(),
    endDateTime: new Date(endDateTime).toISOString(),
    lobbyBypassSettings: {
      scope: 'everyone',
      isDialInBypassEnabled: true
    },
    autoAdmittedUsers: 'everyone',
    allowedPresenters: 'organizer',
    recordAutomatically: true,
    isEntryExitAnnounced: false,
    allowMeetingChat: 'enabled',
    allowTeamworkReactions: true
  }

  const meetingResponse = await fetch(`${MS_GRAPH_API_URL}/users/${organizerUserId}/onlineMeetings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(meetingBody)
  })

  if (!meetingResponse.ok) {
    const errorText = await meetingResponse.text()
    console.error('Failed to create online meeting:', errorText)
    return null
  }

  const meetingData = await meetingResponse.json()
  const joinUrl = meetingData.joinUrl
  const onlineMeetingId = meetingData.id

  if (!joinUrl) {
    console.error('No join URL in response:', JSON.stringify(meetingData, null, 2))
    return null
  }

  console.log(`  Step 1: Online meeting created with lobby bypass + auto-recording`)

  // STEP 2: PATCH to disable attendee mic/camera
  try {
    const patchResponse = await fetch(`${MS_GRAPH_API_URL}/users/${organizerUserId}/onlineMeetings/${onlineMeetingId}`, {
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

    if (patchResponse.ok) {
      console.log(`  Step 2: Mic/camera restrictions applied`)
    } else {
      console.log(`  Step 2: Warning - mic/camera patch failed`)
    }
  } catch (patchError) {
    console.log(`  Step 2: Warning - patch error`)
  }

  // STEP 3: Create calendar event linked to the meeting
  // Build attendees list
  const attendees = attendeeEmails
    .filter(email => email && email.trim())
    .map(email => ({
      emailAddress: { address: email.trim() },
      type: 'required'
    }))

  const eventBody = {
    subject,
    start: {
      dateTime: startDateTime,
      timeZone: 'Asia/Kolkata'
    },
    end: {
      dateTime: endDateTime,
      timeZone: 'Asia/Kolkata'
    },
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness',
    onlineMeeting: {
      joinUrl: joinUrl
    },
    attendees,
    responseRequested: false,
    allowNewTimeProposals: false
  }

  try {
    const eventResponse = await fetch(`${MS_GRAPH_API_URL}/users/${organizerUserId}/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventBody)
    })

    if (eventResponse.ok) {
      console.log(`  Step 3: Calendar event created with ${attendees.length} attendees`)
    } else {
      console.log(`  Step 3: Warning - calendar event failed`)
    }
  } catch (eventError) {
    console.log(`  Step 3: Warning - calendar event error`)
  }

  console.log(`  ✅ Meeting ready: ${joinUrl.substring(0, 50)}...`)
  return joinUrl
}

// Parse cohort from table name
function parseCohortFromTableName(tableName: string): { type: string; number: string } | null {
  const name = tableName.replace('_schedule', '')
  const match = name.match(/^([a-zA-Z]+)(\d+)_(\d+)$/)
  
  if (!match) return null
  
  const [, typeRaw, major, minor] = match
  const type = typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1)
  const number = `${major}.${minor}`
  
  return { type, number }
}

// Format date for display
function formatDateForDisplay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-IN', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long', 
    year: 'numeric' 
  })
}

// Generate update email HTML
function generateUpdateEmailHTML(params: {
  recipientName: string
  recipientType: 'student' | 'mentor' | 'supermentor'
  cohortType: string
  cohortNumber: string
  oldDateFormatted: string
  oldTime: string
  newDateFormatted: string
  newTime: string
  subjectName: string
  hasOldMeetingLink: boolean
  newMeetingLink?: string | null
  updateType?: 'reschedule' | 'mentor_removed' | 'mentor_assigned' | 'details_updated'
  additionalInfo?: string
}): string {
  const { 
    recipientName, recipientType, cohortType, cohortNumber, 
    oldDateFormatted, oldTime, newDateFormatted, newTime, 
    subjectName, hasOldMeetingLink, newMeetingLink, updateType = 'reschedule', additionalInfo 
  } = params

  let headerColor = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
  let headerIcon = '⚠️'
  let headerText = 'Schedule Updated'
  let mainMessage = `Your <strong>${cohortType} ${cohortNumber}</strong> class has been rescheduled:`

  if (updateType === 'mentor_removed') {
    headerColor = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
    headerIcon = '📤'
    headerText = 'Class Removed'
    mainMessage = `You have been removed from a <strong>${cohortType} ${cohortNumber}</strong> class:`
  } else if (updateType === 'mentor_assigned') {
    headerColor = 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
    headerIcon = '📥'
    headerText = 'Class Assigned'
    mainMessage = `You have been assigned to a <strong>${cohortType} ${cohortNumber}</strong> class:`
  } else if (updateType === 'details_updated') {
    headerColor = 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'
    headerIcon = '📝'
    headerText = 'Class Details Updated'
    mainMessage = `Details have been updated for your <strong>${cohortType} ${cohortNumber}</strong> class:`
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headerText}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: ${headerColor}; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">${headerIcon} ${headerText}</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
                Hi <strong>${recipientName}</strong>,
              </p>
              
              <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
                ${mainMessage}
              </p>

              ${updateType === 'reschedule' ? `
              <!-- Old Schedule -->
              <div style="background-color: #fef2f2; border-radius: 8px; padding: 15px; margin-bottom: 15px; border-left: 4px solid #ef4444;">
                <p style="margin: 0; font-size: 14px; color: #991b1b; font-weight: 600;">Previous Schedule:</p>
                <p style="margin: 5px 0 0; font-size: 16px; color: #374151;">
                  📅 ${oldDateFormatted}<br>
                  ⏰ ${oldTime}
                </p>
              </div>
              ` : ''}

              <!-- New Schedule / Current Details -->
              <div style="background-color: #ecfdf5; border-radius: 8px; padding: 15px; margin-bottom: 20px; border-left: 4px solid #10b981;">
                <p style="margin: 0; font-size: 14px; color: #065f46; font-weight: 600;">${updateType === 'reschedule' ? 'New Schedule' : 'Class Details'}:</p>
                <p style="margin: 5px 0 0; font-size: 16px; color: #374151;">
                  📅 ${newDateFormatted}<br>
                  ⏰ ${newTime}<br>
                  📚 ${subjectName}
                </p>
              </div>

              ${additionalInfo ? `
              <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
                ${additionalInfo}
              </p>
              ` : ''}

              ${newMeetingLink ? `
              <!-- Meeting Link Button -->
              <div style="margin: 20px 0; text-align: center;">
                <a href="${newMeetingLink}" 
                   style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); 
                          color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; 
                          font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(99, 102, 241, 0.3);">
                  🔗 Join Meeting
                </a>
              </div>
              <p style="margin: 0 0 10px; font-size: 12px; color: #6b7280; text-align: center;">
                Or copy this link: <a href="${newMeetingLink}" style="color: #4f46e5; word-break: break-all;">${newMeetingLink.substring(0, 60)}...</a>
              </p>
              ` : hasOldMeetingLink ? `
              <p style="margin: 0 0 10px; font-size: 14px; color: #6b7280;">
                A new meeting link will be shared before the class.
              </p>
              ` : ''}

              <p style="margin: 20px 0 0; font-size: 14px; color: #6b7280;">
                Please update your calendar accordingly.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 12px; color: #6b7280;">
                This is an automated notification from MentiBY.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// Send update notification emails and WhatsApp
async function sendUpdateNotifications(params: {
  tableName: string
  session: any
  oldDate: string
  oldTime: string
  newDate: string
  newTime: string
  supabaseMain: any
  supabaseB: any
  updateType?: 'reschedule' | 'mentor_removed' | 'mentor_assigned' | 'details_updated'
  oldMentorId?: number | null
  newMentorId?: number | null
  newMeetingLink?: string | null
  changedField?: string
}): Promise<{ 
  studentsSent: number
  mentorSent: boolean 
  supermentorsSent: number
  whatsappSent: { students: number; mentor: boolean; supermentors: number }
  oldMentorNotified: boolean
  newMentorNotified: boolean
  originalMentorNotified: boolean
  swappedMentorNotified: boolean
}> {
  const { 
    tableName, session, oldDate, oldTime, newDate, newTime, supabaseMain, supabaseB,
    updateType = 'reschedule', oldMentorId, newMentorId, newMeetingLink, changedField
  } = params
  
  const result = { 
    studentsSent: 0, 
    mentorSent: false, 
    supermentorsSent: 0,
    whatsappSent: { students: 0, mentor: false, supermentors: 0 },
    oldMentorNotified: false,
    newMentorNotified: false,
    originalMentorNotified: false,
    swappedMentorNotified: false
  }
  
  // Check if this is a swap scenario (swapped_mentor_id changed, mentor_id unchanged)
  const isSwapChange = changedField === 'swapped_mentor_id'

  try {
    const cohortInfo = parseCohortFromTableName(tableName)
    if (!cohortInfo) {
      console.log('Could not parse cohort info from table name')
      return result
    }

    const oldDateFormatted = formatDateForDisplay(oldDate)
    const newDateFormatted = formatDateForDisplay(newDate)
    const subjectName = session.subject_name || 'N/A'

    // Get students from this cohort
    // Note: Column names with spaces need exact matching
    const { data: students, error: studentsError } = await supabaseMain
      .from('onboarding')
      .select('"EnrollmentID", "Full Name", "Email", "Phone Number"')
      .eq('Cohort Type', cohortInfo.type)
      .eq('Cohort Number', cohortInfo.number)

    if (studentsError || !students) {
      console.log('Could not fetch students:', studentsError?.message)
    }

    // Get current mentor info (Mentor Details is in DB B)
    const effectiveMentorId = session.swapped_mentor_id ?? session.mentor_id
    let currentMentor = null
    if (effectiveMentorId) {
      const { data } = await supabaseB
        .from('Mentor Details')
        .select('mentor_id, "Name", "Email address", "Mobile number"')
        .eq('mentor_id', effectiveMentorId)
        .single()
      currentMentor = data
      console.log(`  Mentor ${effectiveMentorId}: ${data?.['Name'] || 'NOT FOUND'} (${data?.['Email address'] || 'NO EMAIL'})`)
    }

    // Get original mentor (mentor_id) - needed for swap notifications
    let originalMentor = null
    if (session.mentor_id && isSwapChange) {
      const { data } = await supabaseB
        .from('Mentor Details')
        .select('mentor_id, "Name", "Email address", "Mobile number"')
        .eq('mentor_id', session.mentor_id)
        .single()
      originalMentor = data
      console.log(`  Original Mentor (for swap): ${data?.['Name'] || 'NOT FOUND'}`)
    }

    // Get swapped mentor (the new swapped_mentor_id value)
    let swappedMentor = null
    if (isSwapChange && newMentorId) {
      const { data } = await supabaseB
        .from('Mentor Details')
        .select('mentor_id, "Name", "Email address", "Mobile number"')
        .eq('mentor_id', newMentorId)
        .single()
      swappedMentor = data
      console.log(`  Swapped Mentor: ${data?.['Name'] || 'NOT FOUND'}`)
    }

    // Get old swapped mentor (if swap is being changed/removed)
    let oldSwappedMentor = null
    if (isSwapChange && oldMentorId) {
      const { data } = await supabaseB
        .from('Mentor Details')
        .select('mentor_id, "Name", "Email address", "Mobile number"')
        .eq('mentor_id', oldMentorId)
        .single()
      oldSwappedMentor = data
      console.log(`  Old Swapped Mentor: ${data?.['Name'] || 'NOT FOUND'}`)
    }

    // Get old mentor info (for mentor_id change notifications - not swap)
    let oldMentor = null
    if (oldMentorId && oldMentorId !== effectiveMentorId && !isSwapChange) {
      const { data } = await supabaseB
        .from('Mentor Details')
        .select('mentor_id, "Name", "Email address", "Mobile number"')
        .eq('mentor_id', oldMentorId)
        .single()
      oldMentor = data
    }

    // Get new mentor info (for mentor_id change notifications - not swap)
    let newMentor = null
    if (newMentorId && newMentorId !== (oldMentorId || session.mentor_id) && !isSwapChange) {
      const { data } = await supabaseB
        .from('Mentor Details')
        .select('mentor_id, "Name", "Email address", "Mobile number"')
        .eq('mentor_id', newMentorId)
        .single()
      newMentor = data
    }

    // Get all supermentors
    const { data: supermentors, error: supermentorsError } = await supabaseMain
      .from('supermentor_details')
      .select('supermentor_id, name, phone_num, email')

    if (supermentorsError) {
      console.log('Could not fetch supermentors:', supermentorsError.message)
    }

    // Helper function to send email with rate limiting
    const sendEmailWithDelay = async (emailParams: { to: string; subject: string; html: string }) => {
      const success = await sendEmail(emailParams)
      await new Promise(resolve => setTimeout(resolve, 600))
      return success
    }

    // Helper function to send WhatsApp with rate limiting
    const sendWhatsAppWithDelay = async (waParams: any) => {
      const success = await sendWhatsAppMessage(waParams)
      await new Promise(resolve => setTimeout(resolve, 600))
      return success
    }

    // 1. Send to students (if reschedule or details_updated)
    if (students && students.length > 0 && (updateType === 'reschedule' || updateType === 'details_updated')) {
      for (const student of students) {
        const email = student['Email']
        const phone = formatPhoneForWhatsApp(student['Phone Number'])
        const name = student['Full Name'] || 'Student'
        
        if (email) {
          try {
            const success = await sendEmailWithDelay({
              to: email,
              subject: `📅 Class ${updateType === 'reschedule' ? 'Rescheduled' : 'Updated'} - ${cohortInfo.type} ${cohortInfo.number}`,
              html: generateUpdateEmailHTML({
                recipientName: name,
                recipientType: 'student',
                cohortType: cohortInfo.type,
                cohortNumber: cohortInfo.number,
                oldDateFormatted,
                oldTime,
                newDateFormatted,
                newTime,
                subjectName,
                hasOldMeetingLink: !!session.teams_meeting_link,
                newMeetingLink,
                updateType
              })
            })
            
            if (success) result.studentsSent++
          } catch (error) {
            console.error(`Failed to send email to student ${email}:`, error)
          }
        }

        if (phone) {
          try {
            const success = await sendWhatsAppWithDelay({
              to: phone,
              recipientName: name,
              cohortType: cohortInfo.type,
              cohortNumber: cohortInfo.number,
              oldDate: oldDateFormatted,
              oldTime,
              newDate: newDateFormatted,
              newTime,
              subjectName,
              meetingLink: newMeetingLink
            })
            
            if (success) result.whatsappSent.students++
          } catch (error) {
            console.error(`Failed to send WhatsApp to student ${phone}:`, error)
          }
        }
      }
    }

    // 2. Handle SWAP scenario notifications
    if (isSwapChange) {
      console.log('  Handling swap notifications...')
      
      // 2a. Notify original mentor (mentor_id) about the swap
      if (originalMentor && originalMentor['Email address']) {
        const swapStatus = newMentorId 
          ? `Your class is being covered by ${swappedMentor?.['Name'] || 'another mentor'}`
          : 'You are back on duty for this class'
        
        try {
          const success = await sendEmailWithDelay({
            to: originalMentor['Email address'],
            subject: `🔄 Class Coverage Update - ${cohortInfo.type} ${cohortInfo.number}`,
            html: generateUpdateEmailHTML({
              recipientName: originalMentor['Name'] || 'Mentor',
              recipientType: 'mentor',
              cohortType: cohortInfo.type,
              cohortNumber: cohortInfo.number,
              oldDateFormatted: newDateFormatted,
              oldTime: newTime,
              newDateFormatted,
              newTime,
              subjectName,
              hasOldMeetingLink: false,
              newMeetingLink,
              updateType: 'details_updated',
              additionalInfo: swapStatus
            })
          })
          result.originalMentorNotified = success
          console.log(`  Original mentor (${originalMentor['Name']}) notified: ${success}`)
        } catch (error) {
          console.error('Failed to send email to original mentor:', error)
        }

        const originalMentorPhone = formatPhoneForWhatsApp(originalMentor['Mobile number'])
        if (originalMentorPhone) {
          try {
            await sendWhatsAppWithDelay({
              to: originalMentorPhone,
              recipientName: originalMentor['Name'] || 'Mentor',
              cohortType: cohortInfo.type,
              cohortNumber: cohortInfo.number,
              oldDate: newDateFormatted,
              oldTime: newTime,
              newDate: newDateFormatted,
              newTime,
              subjectName,
              meetingLink: newMeetingLink
            })
          } catch (error) {
            console.error('Failed to send WhatsApp to original mentor:', error)
          }
        }
      }

      // 2b. Notify new swapped mentor (they are covering the class)
      if (swappedMentor && swappedMentor['Email address']) {
        try {
          const success = await sendEmailWithDelay({
            to: swappedMentor['Email address'],
            subject: `📥 Class Coverage Assigned - ${cohortInfo.type} ${cohortInfo.number}`,
            html: generateUpdateEmailHTML({
              recipientName: swappedMentor['Name'] || 'Mentor',
              recipientType: 'mentor',
              cohortType: cohortInfo.type,
              cohortNumber: cohortInfo.number,
              oldDateFormatted: newDateFormatted,
              oldTime: newTime,
              newDateFormatted,
              newTime,
              subjectName,
              hasOldMeetingLink: false,
              newMeetingLink,
              updateType: 'mentor_assigned',
              additionalInfo: `You are covering this class for ${originalMentor?.['Name'] || 'another mentor'}.`
            })
          })
          result.swappedMentorNotified = success
          console.log(`  Swapped mentor (${swappedMentor['Name']}) notified: ${success}`)
        } catch (error) {
          console.error('Failed to send email to swapped mentor:', error)
        }

        const swappedMentorPhone = formatPhoneForWhatsApp(swappedMentor['Mobile number'])
        if (swappedMentorPhone) {
          try {
            await sendWhatsAppWithDelay({
              to: swappedMentorPhone,
              recipientName: swappedMentor['Name'] || 'Mentor',
              cohortType: cohortInfo.type,
              cohortNumber: cohortInfo.number,
              oldDate: newDateFormatted,
              oldTime: newTime,
              newDate: newDateFormatted,
              newTime,
              subjectName,
              meetingLink: newMeetingLink
            })
          } catch (error) {
            console.error('Failed to send WhatsApp to swapped mentor:', error)
          }
        }
      }

      // 2c. Notify old swapped mentor (coverage removed)
      if (oldSwappedMentor && oldSwappedMentor['Email address'] && oldSwappedMentor.mentor_id !== swappedMentor?.mentor_id) {
        try {
          const success = await sendEmailWithDelay({
            to: oldSwappedMentor['Email address'],
            subject: `📤 Class Coverage Removed - ${cohortInfo.type} ${cohortInfo.number}`,
            html: generateUpdateEmailHTML({
              recipientName: oldSwappedMentor['Name'] || 'Mentor',
              recipientType: 'mentor',
              cohortType: cohortInfo.type,
              cohortNumber: cohortInfo.number,
              oldDateFormatted: newDateFormatted,
              oldTime: newTime,
              newDateFormatted,
              newTime,
              subjectName,
              hasOldMeetingLink: false,
              updateType: 'mentor_removed',
              additionalInfo: 'Your class coverage has been removed.'
            })
          })
          console.log(`  Old swapped mentor (${oldSwappedMentor['Name']}) notified: ${success}`)
        } catch (error) {
          console.error('Failed to send email to old swapped mentor:', error)
        }

        const oldSwappedMentorPhone = formatPhoneForWhatsApp(oldSwappedMentor['Mobile number'])
        if (oldSwappedMentorPhone) {
          try {
            await sendWhatsAppWithDelay({
              to: oldSwappedMentorPhone,
              recipientName: oldSwappedMentor['Name'] || 'Mentor',
              cohortType: cohortInfo.type,
              cohortNumber: cohortInfo.number,
              oldDate: newDateFormatted,
              oldTime: newTime,
              newDate: newDateFormatted,
              newTime,
              subjectName,
              meetingLink: null
            })
          } catch (error) {
            console.error('Failed to send WhatsApp to old swapped mentor:', error)
          }
        }
      }
    } 
    // 2. Send to current mentor (non-swap scenarios)
    else if (currentMentor && currentMentor['Email address']) {
      try {
        const success = await sendEmailWithDelay({
          to: currentMentor['Email address'],
          subject: `📅 Class ${updateType === 'reschedule' ? 'Rescheduled' : 'Updated'} - ${cohortInfo.type} ${cohortInfo.number}`,
          html: generateUpdateEmailHTML({
            recipientName: currentMentor['Name'] || 'Mentor',
            recipientType: 'mentor',
            cohortType: cohortInfo.type,
            cohortNumber: cohortInfo.number,
            oldDateFormatted,
            oldTime,
            newDateFormatted,
            newTime,
            subjectName,
            hasOldMeetingLink: !!session.teams_meeting_link,
            newMeetingLink,
            updateType
          })
        })
        
        result.mentorSent = success
      } catch (error) {
        console.error(`Failed to send email to mentor:`, error)
      }

      const mentorPhone = formatPhoneForWhatsApp(currentMentor['Mobile number'])
      if (mentorPhone) {
        try {
          const success = await sendWhatsAppWithDelay({
            to: mentorPhone,
            recipientName: currentMentor['Name'] || 'Mentor',
            cohortType: cohortInfo.type,
            cohortNumber: cohortInfo.number,
            oldDate: oldDateFormatted,
            oldTime,
            newDate: newDateFormatted,
            newTime,
            subjectName,
            meetingLink: newMeetingLink
          })
          
          result.whatsappSent.mentor = success
        } catch (error) {
          console.error(`Failed to send WhatsApp to mentor:`, error)
        }
      }
    }

    // 3. Send to old mentor (class removed notification) - for mentor_id changes only
    if (oldMentor && oldMentor['Email address']) {
      try {
        const success = await sendEmailWithDelay({
          to: oldMentor['Email address'],
          subject: `📤 Class Removed - ${cohortInfo.type} ${cohortInfo.number}`,
          html: generateUpdateEmailHTML({
            recipientName: oldMentor['Name'] || 'Mentor',
            recipientType: 'mentor',
            cohortType: cohortInfo.type,
            cohortNumber: cohortInfo.number,
            oldDateFormatted,
            oldTime,
            newDateFormatted,
            newTime,
            subjectName,
            hasOldMeetingLink: false,
            updateType: 'mentor_removed',
            additionalInfo: 'This class has been reassigned to another mentor.'
          })
        })
        
        result.oldMentorNotified = success
      } catch (error) {
        console.error(`Failed to send removal email to old mentor:`, error)
      }

      const oldMentorPhone = formatPhoneForWhatsApp(oldMentor['Mobile number'])
      if (oldMentorPhone) {
        try {
          await sendWhatsAppWithDelay({
            to: oldMentorPhone,
            recipientName: oldMentor['Name'] || 'Mentor',
            cohortType: cohortInfo.type,
            cohortNumber: cohortInfo.number,
            oldDate: oldDateFormatted,
            oldTime,
            newDate: newDateFormatted,
            newTime,
            subjectName,
            meetingLink: newMeetingLink
          })
        } catch (error) {
          console.error(`Failed to send WhatsApp to old mentor:`, error)
        }
      }
    }

    // 4. Send to new mentor (class assigned notification)
    if (newMentor && newMentor['Email address']) {
      try {
        const success = await sendEmailWithDelay({
          to: newMentor['Email address'],
          subject: `📥 Class Assigned - ${cohortInfo.type} ${cohortInfo.number}`,
          html: generateUpdateEmailHTML({
            recipientName: newMentor['Name'] || 'Mentor',
            recipientType: 'mentor',
            cohortType: cohortInfo.type,
            cohortNumber: cohortInfo.number,
            oldDateFormatted: newDateFormatted,
            oldTime: newTime,
            newDateFormatted,
            newTime,
            subjectName,
            hasOldMeetingLink: false,
            updateType: 'mentor_assigned',
            additionalInfo: 'You have been assigned to take this class.'
          })
        })
        
        result.newMentorNotified = success
      } catch (error) {
        console.error(`Failed to send assignment email to new mentor:`, error)
      }

      const newMentorPhone = formatPhoneForWhatsApp(newMentor['Mobile number'])
      if (newMentorPhone) {
        try {
          await sendWhatsAppWithDelay({
            to: newMentorPhone,
            recipientName: newMentor['Name'] || 'Mentor',
            cohortType: cohortInfo.type,
            cohortNumber: cohortInfo.number,
            oldDate: newDateFormatted,
            oldTime: newTime,
            newDate: newDateFormatted,
            newTime,
            subjectName,
            meetingLink: newMeetingLink
          })
        } catch (error) {
          console.error(`Failed to send WhatsApp to new mentor:`, error)
        }
      }
    }

    // 5. Send to all supermentors
    if (supermentors && supermentors.length > 0) {
      for (const supermentor of supermentors) {
        if (supermentor.email) {
          try {
            const success = await sendEmailWithDelay({
              to: supermentor.email,
              subject: `📅 [Admin] Class ${updateType === 'reschedule' ? 'Rescheduled' : 'Updated'} - ${cohortInfo.type} ${cohortInfo.number}`,
              html: generateUpdateEmailHTML({
                recipientName: supermentor.name || 'Admin',
                recipientType: 'supermentor',
                cohortType: cohortInfo.type,
                cohortNumber: cohortInfo.number,
                oldDateFormatted,
                oldTime,
                newDateFormatted,
                newTime,
                subjectName,
                hasOldMeetingLink: !!session.teams_meeting_link,
                newMeetingLink,
                updateType,
                additionalInfo: oldMentor ? `Mentor changed from ${oldMentor['Name']} to ${currentMentor?.['Name'] || 'N/A'}` : undefined
              })
            })
            
            if (success) result.supermentorsSent++
          } catch (error) {
            console.error(`Failed to send email to supermentor ${supermentor.email}:`, error)
          }
        }

        const supermentorPhone = formatPhoneForWhatsApp(supermentor.phone_num)
        if (supermentorPhone) {
          try {
            const success = await sendWhatsAppWithDelay({
              to: supermentorPhone,
              recipientName: supermentor.name || 'Admin',
              cohortType: cohortInfo.type,
              cohortNumber: cohortInfo.number,
              oldDate: oldDateFormatted,
              oldTime,
              newDate: newDateFormatted,
              newTime,
              subjectName,
              meetingLink: newMeetingLink
            })
            
            if (success) result.whatsappSent.supermentors++
          } catch (error) {
            console.error(`Failed to send WhatsApp to supermentor:`, error)
          }
        }
      }
    }

    return result
  } catch (error) {
    console.error('Error sending update notifications:', error)
    return result
  }
}

// Main handler for session updates
// Called after date/time/mentor/details changes to handle meeting recreation and notifications
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { 
      tableName, 
      sessionId, 
      oldDate, 
      oldTime, 
      newDate, 
      newTime,
      skipMeetingRegeneration = false,
      // New parameters for extended field support
      changedField,
      oldValue,
      newValue,
      oldMentorId,
      newMentorId,
      oldSessionType,
      newSessionType,
      // New session flag - when adding a new session
      isNewSession = false
    } = body

    if (!tableName || !sessionId) {
      return NextResponse.json({ error: 'tableName and sessionId are required' }, { status: 400 })
    }

    console.log(`\n=== Session Update Handler ===`)
    console.log(`Table: ${tableName}, Session ID: ${sessionId}`)
    console.log(`Is new session: ${isNewSession}`)
    console.log(`Changed field: ${changedField || 'date/time'}`)
    if (oldDate || newDate) console.log(`Date: ${oldDate} → ${newDate}`)
    if (oldTime || newTime) console.log(`Time: ${oldTime} → ${newTime}`)
    if (changedField === 'mentor_id' || changedField === 'swapped_mentor_id') {
      console.log(`Mentor: ${oldMentorId || oldValue} → ${newMentorId || newValue}`)
    }
    if (oldSessionType || newSessionType) {
      console.log(`Session type: ${oldSessionType} → ${newSessionType}`)
    }

    const supabaseB = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL_B!,
      process.env.SUPABASE_SERVICE_ROLE_KEY_B!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const supabaseMain = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Fetch the session
    const { data: session, error: fetchError } = await supabaseB
      .from(tableName)
      .select('*')
      .eq('id', sessionId)
      .single()

    if (fetchError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const results = {
      meetingDeleted: false,
      meetingCreated: false,
      newMeetingLink: null as string | null,
      meetingLinkCleared: false,
      notificationsSent: { 
        studentsSent: 0, 
        mentorSent: false, 
        supermentorsSent: 0,
        whatsappSent: { students: 0, mentor: false, supermentors: 0 },
        oldMentorNotified: false,
        newMentorNotified: false,
        originalMentorNotified: false,
        swappedMentorNotified: false
      }
    }

    // Determine if this is a contest session (current or changed to)
    const currentIsContest = session.session_type && session.session_type.toLowerCase() === 'contest'
    const changedToContest = newSessionType && newSessionType.toLowerCase() === 'contest'
    const isContest = currentIsContest || changedToContest

    // Determine if mentor changed
    const mentorChanged = changedField === 'mentor_id' || changedField === 'swapped_mentor_id'
    const effectiveOldMentorId = oldMentorId || (mentorChanged ? oldValue : null)
    const effectiveNewMentorId = newMentorId || (mentorChanged ? newValue : null)

    // Step 1: Handle meeting link
    if (isContest) {
      console.log('Contest session - skipping meeting link creation (contests don\'t have Teams links)')
      
      // If changed TO contest and had a meeting link, delete it
      if (changedToContest && session.teams_meeting_link) {
        console.log('Session type changed to contest - deleting existing meeting link...')
        try {
          const accessToken = await getAccessToken()
          results.meetingDeleted = await deleteTeamsMeeting(accessToken, session.teams_meeting_link)
          
          // Clear the meeting link in DB
          await supabaseB
            .from(tableName)
            .update({ teams_meeting_link: null })
            .eq('id', sessionId)
          
          results.meetingLinkCleared = true
          console.log('Meeting link cleared for contest session')
        } catch (error) {
          console.error('Error clearing meeting for contest:', error)
        }
      }
    } else if (session.teams_meeting_link && !skipMeetingRegeneration) {
      console.log('Session has meeting link - handling regeneration...')
      
      try {
        const accessToken = await getAccessToken()
        
        // Delete old meeting
        results.meetingDeleted = await deleteTeamsMeeting(accessToken, session.teams_meeting_link)
        
        // Create new meeting with updated date/time
        // Handle date - could be Date object or string from DB
        let effectiveDate = newDate || session.date
        if (effectiveDate instanceof Date) {
          effectiveDate = effectiveDate.toISOString().split('T')[0]
        } else if (typeof effectiveDate === 'string' && effectiveDate.includes('T')) {
          effectiveDate = effectiveDate.split('T')[0]
        }
        
        // Handle time - could have seconds or not
        let effectiveTime = newTime || session.time || '19:00'
        if (typeof effectiveTime === 'string') {
          // Ensure HH:MM format (strip seconds if present)
          effectiveTime = effectiveTime.substring(0, 5)
        }
        
        console.log(`Creating meeting for date: ${effectiveDate}, time: ${effectiveTime}`)
        
        // Calendar event API uses timeZone parameter, so datetime is simple format
        const startDateTime = `${effectiveDate}T${effectiveTime}:00`
        
        // Calculate end time (1.5 hours later, same as cron)
        const startDate = new Date(`${effectiveDate}T${effectiveTime}:00`)
        startDate.setMinutes(startDate.getMinutes() + 90)
        const endDateTime = `${effectiveDate}T${startDate.toTimeString().slice(0, 8)}`
        
        console.log(`Meeting times: ${startDateTime} to ${endDateTime}`)

        const cohortInfo = parseCohortFromTableName(tableName)
        const subject = cohortInfo 
          ? `Cohort ${cohortInfo.type} ${cohortInfo.number} - ${session.subject_name || 'Session'}`
          : `Cohort - ${session.subject_name || 'Session'}`

        // Build attendee list (mentor + students)
        const attendeeEmails: string[] = []
        
        // Get mentor email
        const mentorId = session.swapped_mentor_id || session.mentor_id
        if (mentorId) {
          const { data: mentor } = await supabaseB
            .from('Mentor Details')
            .select('"Email address"')
            .eq('mentor_id', mentorId)
            .single()
          if (mentor?.['Email address']) {
            attendeeEmails.push(mentor['Email address'])
          }
        }
        
        // Get student emails for this cohort
        if (cohortInfo) {
          const { data: students } = await supabaseMain
            .from('onboarding')
            .select('"Email"')
            .eq('"Cohort Type"', cohortInfo.type)
            .eq('"Cohort Number"', cohortInfo.number)
          if (students) {
            students.forEach(s => {
              if (s['Email']) attendeeEmails.push(s['Email'])
            })
          }
        }
        
        console.log(`  Adding ${attendeeEmails.length} attendees to meeting`)

        const newLink = await createTeamsMeeting(accessToken, subject, startDateTime, endDateTime, attendeeEmails)
        
        if (newLink) {
          results.meetingCreated = true
          results.newMeetingLink = newLink
          
          // Update the session with new meeting link
          await supabaseB
            .from(tableName)
            .update({ teams_meeting_link: newLink })
            .eq('id', sessionId)
          
          console.log('Updated session with new meeting link')
        }
      } catch (error) {
        console.error('Error handling meeting:', error)
      }
    } else if (isNewSession && !session.teams_meeting_link && !isContest) {
      // NEW SESSION: Create meeting link for the first time
      console.log('New session without meeting link - creating Teams meeting...')
      
      try {
        const accessToken = await getAccessToken()
        
        // Get date and time from session
        let effectiveDate = session.date
        if (effectiveDate instanceof Date) {
          effectiveDate = effectiveDate.toISOString().split('T')[0]
        } else if (typeof effectiveDate === 'string' && effectiveDate.includes('T')) {
          effectiveDate = effectiveDate.split('T')[0]
        }
        
        let effectiveTime = session.time || '19:00'
        if (typeof effectiveTime === 'string') {
          effectiveTime = effectiveTime.substring(0, 5)
        }
        
        console.log(`Creating meeting for new session: ${effectiveDate}, ${effectiveTime}`)
        
        const startDateTime = `${effectiveDate}T${effectiveTime}:00`
        
        // Calculate end time (1.5 hours later)
        const startDate = new Date(`${effectiveDate}T${effectiveTime}:00`)
        startDate.setMinutes(startDate.getMinutes() + 90)
        const endDateTime = `${effectiveDate}T${startDate.toTimeString().slice(0, 8)}`
        
        // Generate subject line (same format as cron: "Cohort Basic 6.0 - Subject Name")
        const cohortInfo = parseCohortFromTableName(tableName)
        const subject = cohortInfo 
          ? `Cohort ${cohortInfo.type} ${cohortInfo.number} - ${session.subject_name || 'Session'}`
          : `Cohort - ${session.subject_name || 'Session'}`
        
        // Build attendee list (mentor + students)
        const attendeeEmails: string[] = []
        
        // Get mentor email
        const mentorId = session.swapped_mentor_id || session.mentor_id
        if (mentorId) {
          const { data: mentor } = await supabaseB
            .from('Mentor Details')
            .select('"Email address"')
            .eq('mentor_id', mentorId)
            .single()
          if (mentor?.['Email address']) {
            attendeeEmails.push(mentor['Email address'])
          }
        }
        
        // Get student emails for this cohort
        if (cohortInfo) {
          const { data: students } = await supabaseMain
            .from('onboarding')
            .select('"Email"')
            .eq('"Cohort Type"', cohortInfo.type)
            .eq('"Cohort Number"', cohortInfo.number)
          if (students) {
            students.forEach(s => {
              if (s['Email']) attendeeEmails.push(s['Email'])
            })
          }
        }
        
        console.log(`  Adding ${attendeeEmails.length} attendees to new session meeting`)
        
        // Create meeting using calendar event
        const newMeetingLink = await createTeamsMeeting(
          accessToken,
          subject,
          startDateTime,
          endDateTime,
          attendeeEmails
        )
        
        if (newMeetingLink) {
          results.meetingCreated = true
          results.newMeetingLink = newMeetingLink
          
          // Update session with meeting link
          const { error: updateError } = await supabaseB
            .from(tableName)
            .update({ teams_meeting_link: newMeetingLink })
            .eq('id', sessionId)
          
          if (updateError) {
            console.error('Failed to save meeting link to DB:', updateError)
          } else {
            console.log('New session updated with meeting link:', newMeetingLink)
          }
        }
      } catch (error) {
        console.error('Error creating meeting for new session:', error)
      }
    }

    // Step 2: Determine update type and send notifications
    let updateType: 'reschedule' | 'mentor_removed' | 'mentor_assigned' | 'details_updated' = 'reschedule'
    
    if (changedField === 'date' || changedField === 'time') {
      updateType = 'reschedule'
    } else if (changedField === 'mentor_id' || changedField === 'swapped_mentor_id') {
      updateType = 'details_updated' // We'll handle old/new mentor separately
    } else if (changedField === 'subject_name' || changedField === 'session_type' || changedField === 'subject_topic') {
      updateType = 'details_updated'
    }

    // For swap scenarios, ALWAYS notify mentors (they need to know about coverage)
    // For other changes, only notify if students were already notified
    const isSwapChange = changedField === 'swapped_mentor_id'
    const shouldSendNotifications = isSwapChange || session.email_sent === true || session.whatsapp_sent === true

    if (shouldSendNotifications) {
      if (isSwapChange) {
        console.log('Swap detected - sending mentor coverage notifications...')
      } else {
        console.log('Notifications were already sent - sending update notifications...')
      }
      
      results.notificationsSent = await sendUpdateNotifications({
        tableName,
        session,
        oldDate: oldDate || session.date,
        oldTime: oldTime || session.time || '19:00',
        newDate: newDate || session.date,
        newTime: newTime || session.time || '19:00',
        supabaseMain,
        supabaseB,
        updateType,
        oldMentorId: effectiveOldMentorId,
        newMentorId: effectiveNewMentorId,
        newMeetingLink: results.newMeetingLink,
        changedField
      })
      
      console.log(`Notifications sent:`)
      console.log(`  - Students (email): ${results.notificationsSent.studentsSent}`)
      console.log(`  - Students (WhatsApp): ${results.notificationsSent.whatsappSent.students}`)
      console.log(`  - Mentor: ${results.notificationsSent.mentorSent}`)
      console.log(`  - Supermentors (email): ${results.notificationsSent.supermentorsSent}`)
      console.log(`  - Supermentors (WhatsApp): ${results.notificationsSent.whatsappSent.supermentors}`)
      if (changedField === 'swapped_mentor_id') {
        console.log(`  - Original mentor notified: ${results.notificationsSent.originalMentorNotified}`)
        console.log(`  - Swapped mentor notified: ${results.notificationsSent.swappedMentorNotified}`)
      } else if (mentorChanged) {
        console.log(`  - Old mentor notified: ${results.notificationsSent.oldMentorNotified}`)
        console.log(`  - New mentor notified: ${results.notificationsSent.newMentorNotified}`)
      }
    } else {
      console.log('Notifications not yet sent - skipping update notifications')
    }

    // Step 3: Reset email_sent and whatsapp_sent to false so daily cron will resend
    if (session.email_sent === true || session.whatsapp_sent === true) {
      console.log('Resetting email_sent and whatsapp_sent to false for fresh notifications...')
      
      const { error: resetError } = await supabaseB
        .from(tableName)
        .update({ 
          email_sent: false, 
          whatsapp_sent: false 
        })
        .eq('id', sessionId)
      
      if (resetError) {
        console.error('Failed to reset notification flags:', resetError)
      } else {
        console.log('Notification flags reset - daily cron will send fresh notifications')
      }
    }

    return NextResponse.json({
      success: true,
      results
    })

  } catch (error: any) {
    console.error('Session update handler error:', error)
    return NextResponse.json({ error: error.message || 'An error occurred' }, { status: 500 })
  }
}
