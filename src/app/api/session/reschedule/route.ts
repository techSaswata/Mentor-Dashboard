import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'

// WhatsApp Cloud API Configuration
const WHATSAPP_API_URL = 'https://graph.facebook.com/v19.0'

// Format phone number for WhatsApp (must be E.164 format without +)
function formatPhoneForWhatsApp(phone: string | number | null | undefined): string | null {
  if (!phone) return null
  
  const phoneStr = String(phone)
  let cleaned = phoneStr.replace(/\D/g, '')
  
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned
  } else if (cleaned.startsWith('0')) {
    cleaned = '91' + cleaned.substring(1)
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1)
  }
  
  if (cleaned.length < 10 || cleaned.length > 15) {
    return null
  }
  
  return cleaned
}

// Send WhatsApp message using Cloud API
async function sendWhatsAppMessage(params: {
  to: string
  templateName: string
  components: any[]
}): Promise<boolean> {
  const { to, templateName, components } = params
  
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  
  if (!phoneNumberId || !accessToken) {
    console.log('WhatsApp credentials not configured')
    return false
  }
  
  try {
    const response = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components
        }
      })
    })
    
    if (!response.ok) {
      const errorData = await response.json()
      console.log(`WhatsApp API error for ${to}:`, JSON.stringify(errorData))
      return false
    }
    
    return true
  } catch (error) {
    console.error('WhatsApp API error:', error)
    return false
  }
}

// Generate email HTML for super mentors
function generateRescheduleEmailForSuperMentor(params: {
  superMentorName: string
  cohortName: string
  subjectName: string
  originalDate: string
  originalTime: string
  newDate: string
  newTime: string
  actionType: 'prepone' | 'postpone'
  mentorName: string
}): string {
  const { superMentorName, cohortName, subjectName, originalDate, originalTime, newDate, newTime, actionType, mentorName } = params
  const actionLabel = actionType === 'prepone' ? 'Preponed' : 'Postponed'
  const actionColor = actionType === 'prepone' ? '#06b6d4' : '#f97316'
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 16px; overflow: hidden; border: 1px solid #334155;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, ${actionColor}20 0%, ${actionColor}10 100%); padding: 30px; text-align: center; border-bottom: 1px solid #334155;">
        <div style="font-size: 48px; margin-bottom: 10px;">📅</div>
        <h1 style="color: ${actionColor}; margin: 0; font-size: 24px;">Class ${actionLabel}</h1>
        <p style="color: #94a3b8; margin: 10px 0 0 0; font-size: 14px;">${cohortName} - ${subjectName}</p>
      </div>
      
      <!-- Body -->
      <div style="padding: 30px;">
        <p style="color: #e2e8f0; font-size: 16px; margin: 0 0 20px 0;">Hi ${superMentorName},</p>
        <p style="color: #94a3b8; font-size: 14px; margin: 0 0 25px 0;">A class has been ${actionLabel.toLowerCase()} by <strong style="color: #e2e8f0;">${mentorName}</strong>.</p>
        
        <!-- Schedule Change Box -->
        <div style="background: #0f172a; border-radius: 12px; padding: 20px; border: 1px solid #334155;">
          <div style="display: flex; margin-bottom: 15px;">
            <div style="flex: 1;">
              <p style="color: #64748b; font-size: 12px; margin: 0 0 5px 0; text-transform: uppercase;">Original Schedule</p>
              <p style="color: #ef4444; font-size: 14px; margin: 0; text-decoration: line-through;">${originalDate}</p>
              <p style="color: #ef4444; font-size: 14px; margin: 5px 0 0 0; text-decoration: line-through;">${originalTime}</p>
            </div>
          </div>
          <div style="border-top: 1px dashed #334155; padding-top: 15px;">
            <p style="color: #64748b; font-size: 12px; margin: 0 0 5px 0; text-transform: uppercase;">New Schedule</p>
            <p style="color: #22c55e; font-size: 16px; margin: 0; font-weight: 600;">${newDate}</p>
            <p style="color: #22c55e; font-size: 16px; margin: 5px 0 0 0; font-weight: 600;">${newTime}</p>
          </div>
        </div>
      </div>
      
      <!-- Footer -->
      <div style="padding: 20px 30px; background: #0f172a; border-top: 1px solid #334155; text-align: center;">
        <p style="color: #64748b; font-size: 12px; margin: 0;">MentiBy Mentor Dashboard</p>
      </div>
    </div>
  </div>
</body>
</html>
  `
}

// Generate email HTML for students
function generateRescheduleEmailForStudent(params: {
  studentName: string
  cohortName: string
  subjectName: string
  originalDate: string
  originalTime: string
  newDate: string
  newTime: string
  actionType: 'prepone' | 'postpone'
}): string {
  const { studentName, cohortName, subjectName, originalDate, originalTime, newDate, newTime, actionType } = params
  const actionLabel = actionType === 'prepone' ? 'Preponed' : 'Postponed'
  const actionColor = actionType === 'prepone' ? '#06b6d4' : '#f97316'
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 16px; overflow: hidden; border: 1px solid #334155;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, ${actionColor}20 0%, ${actionColor}10 100%); padding: 30px; text-align: center; border-bottom: 1px solid #334155;">
        <div style="font-size: 48px; margin-bottom: 10px;">🔔</div>
        <h1 style="color: ${actionColor}; margin: 0; font-size: 24px;">Class Schedule Updated</h1>
        <p style="color: #94a3b8; margin: 10px 0 0 0; font-size: 14px;">Your ${subjectName} class has been ${actionLabel.toLowerCase()}</p>
      </div>
      
      <!-- Body -->
      <div style="padding: 30px;">
        <p style="color: #e2e8f0; font-size: 16px; margin: 0 0 20px 0;">Hi ${studentName || 'Student'},</p>
        <p style="color: #94a3b8; font-size: 14px; margin: 0 0 25px 0;">Your upcoming class for <strong style="color: #e2e8f0;">${cohortName}</strong> has been rescheduled.</p>
        
        <!-- Schedule Change Box -->
        <div style="background: #0f172a; border-radius: 12px; padding: 20px; border: 1px solid #334155;">
          <div style="margin-bottom: 15px;">
            <p style="color: #64748b; font-size: 12px; margin: 0 0 5px 0; text-transform: uppercase;">Previous Schedule</p>
            <p style="color: #ef4444; font-size: 14px; margin: 0; text-decoration: line-through;">${originalDate} at ${originalTime}</p>
          </div>
          <div style="border-top: 1px dashed #334155; padding-top: 15px;">
            <p style="color: #64748b; font-size: 12px; margin: 0 0 5px 0; text-transform: uppercase;">New Schedule</p>
            <p style="color: #22c55e; font-size: 18px; margin: 0; font-weight: 600;">${newDate} at ${newTime}</p>
          </div>
        </div>
        
        <p style="color: #94a3b8; font-size: 14px; margin: 25px 0 0 0; text-align: center;">Please update your calendar accordingly.</p>
      </div>
      
      <!-- Footer -->
      <div style="padding: 20px 30px; background: #0f172a; border-top: 1px solid #334155; text-align: center;">
        <p style="color: #64748b; font-size: 12px; margin: 0;">MentiBy Learning Platform</p>
      </div>
    </div>
  </div>
</body>
</html>
  `
}

// Build WhatsApp components for super mentor reschedule notification
function buildRescheduleWhatsAppForSuperMentor(params: {
  superMentorName: string
  cohortName: string
  subjectName: string
  originalDateTime: string
  newDateTime: string
  actionType: string
  mentorName: string
}): any[] {
  return [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: params.superMentorName },
        { type: 'text', text: params.actionType },
        { type: 'text', text: params.cohortName },
        { type: 'text', text: params.subjectName },
        { type: 'text', text: params.originalDateTime },
        { type: 'text', text: params.newDateTime },
        { type: 'text', text: params.mentorName }
      ]
    }
  ]
}

// Build WhatsApp components for student reschedule notification
function buildRescheduleWhatsAppForStudent(params: {
  studentName: string
  cohortName: string
  subjectName: string
  originalDateTime: string
  newDateTime: string
}): any[] {
  return [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: params.studentName || 'Student' },
        { type: 'text', text: params.cohortName },
        { type: 'text', text: params.subjectName },
        { type: 'text', text: params.originalDateTime },
        { type: 'text', text: params.newDateTime }
      ]
    }
  ]
}

// Parse cohort info from table name
function parseCohortFromTableName(tableName: string): { type: string; number: string } | null {
  // e.g., "basic1_1_schedule" -> { type: "Basic", number: "1.1" }
  const match = tableName.match(/^([a-zA-Z]+)(\d+)_(\d+)_schedule$/)
  if (match) {
    const type = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
    const number = `${match[2]}.${match[3]}`
    return { type, number }
  }
  return null
}

// Format date for display
function formatDateForDisplay(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00')
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

// Format time for display
function formatTimeForDisplay(timeStr: string): string {
  if (!timeStr) return 'TBD'
  const [hours, minutes] = timeStr.split(':')
  const h = parseInt(hours)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 || 12
  return `${hour12}:${minutes} ${ampm}`
}

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

    // Initialize Supabase clients
    const supabaseMain = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const supabaseB = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL_B!,
      process.env.SUPABASE_SERVICE_ROLE_KEY_B!
    )

    // Fetch session details
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

    // Check if meeting link exists - if so, create a new one
    let newMeetingLink: string | null = null
    if (session.teams_meeting_link) {
      console.log('Existing meeting link found, creating new meeting...')
      try {
        // Calculate new meeting times
        const sessionDuration = 60 // 1 hour default
        const meetingTime = newTime || session.time
        const startDateTime = `${newDate}T${meetingTime}`
        const endDateTime = new Date(new Date(startDateTime).getTime() + sessionDuration * 60000).toISOString()

        // Get mentor name for meeting subject
        const activeMentorId = session.swapped_mentor_id || session.mentor_id
        const { data: mentor } = await supabaseB
          .from('Mentor Details')
          .select('Name')
          .eq('mentor_id', activeMentorId)
          .single()

        // Parse cohort info for meeting subject
        const cohortMatch = tableName.match(/^([a-zA-Z]+)(\d+)_(\d+)_schedule$/)
        const cohortName = cohortMatch 
          ? `${cohortMatch[1].charAt(0).toUpperCase() + cohortMatch[1].slice(1)} ${cohortMatch[2]}.${cohortMatch[3]}`
          : tableName.replace('_schedule', '')

        const meetingSubject = `${cohortName} - ${session.subject_name || 'Session'} (${mentor?.Name || 'Mentor'})`

        // Create new Teams meeting
        const meetingResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/teams/create-meeting`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: meetingSubject,
            startDateTime,
            endDateTime,
            timeZone: 'Asia/Kolkata'
          })
        })

        if (meetingResponse.ok) {
          const meetingData = await meetingResponse.json()
          newMeetingLink = meetingData.joinUrl
          console.log('New meeting created:', newMeetingLink)
        } else {
          console.error('Failed to create new meeting')
        }
      } catch (meetingError) {
        console.error('Error creating new meeting:', meetingError)
      }
    }

    // Update session date
    const { error: dateError } = await supabaseB
      .from(tableName)
      .update({ date: newDate })
      .eq('id', sessionId)

    if (dateError) {
      throw new Error('Failed to update date')
    }

    // Update day name
    await supabaseB
      .from(tableName)
      .update({ day: newDayName })
      .eq('id', sessionId)

    // Update meeting link (either new one or clear it)
    await supabaseB
      .from(tableName)
      .update({ teams_meeting_link: newMeetingLink })
      .eq('id', sessionId)

    // Update time if provided
    if (newTime) {
      await supabaseB
        .from(tableName)
        .update({ time: newTime })
        .eq('id', sessionId)
    }

    console.log(`Session ${sessionId} ${actionType}d: ${originalDate} -> ${newDate}`)

    // Check if notifications were already sent
    const emailAlreadySent = session.email_sent === true
    const whatsappAlreadySent = session.whatsapp_sent === true
    const shouldSendNotifications = emailAlreadySent || whatsappAlreadySent

    if (!shouldSendNotifications) {
      console.log('Notifications not yet sent for this session, skipping update notifications')
      return NextResponse.json({
        success: true,
        message: `Session ${actionType}d successfully`,
        newMeetingLink,
        notifications: { skipped: true, reason: 'Original notifications not sent yet' }
      })
    }

    console.log('Original notifications were sent, sending update notifications...')

    // Parse cohort info for fetching students
    const cohortInfo = parseCohortFromTableName(tableName)
    const cohortName = cohortInfo 
      ? `${cohortInfo.type} ${cohortInfo.number}` 
      : tableName.replace('_schedule', '').replace(/_/g, ' ')

    // Format dates/times for notifications
    const origDateFormatted = formatDateForDisplay(originalDate || session.date)
    const origTimeFormatted = formatTimeForDisplay(originalTime || session.time)
    const newDateFormatted = formatDateForDisplay(newDate)
    const newTimeFormatted = formatTimeForDisplay(newTime || session.time)
    const subjectName = session.subject_name || 'Class'

    // Template names
    const SUPERMENTOR_WA_TEMPLATE = process.env.WHATSAPP_RESCHEDULE_SUPERMENTOR_TEMPLATE || 'class_rescheduled_supermentor'
    const STUDENT_WA_TEMPLATE = process.env.WHATSAPP_RESCHEDULE_STUDENT_TEMPLATE || 'class_rescheduled_student'

    let superMentorEmailsSent = 0
    let superMentorWASent = 0
    let studentEmailsSent = 0
    let studentWASent = 0

    // ============ SEND TO SUPER MENTORS ============
    const { data: superMentors, error: smError } = await supabaseMain
      .from('supermentor_details')
      .select('*')

    if (smError) {
      console.error('Error fetching super mentors:', smError)
    }

    if (superMentors && superMentors.length > 0) {
      console.log(`Sending reschedule notifications to ${superMentors.length} super mentors`)

      for (const superMentor of superMentors) {
        // Email
        if (superMentor.email) {
          const emailHtml = generateRescheduleEmailForSuperMentor({
            superMentorName: superMentor.name,
            cohortName,
            subjectName,
            originalDate: origDateFormatted,
            originalTime: origTimeFormatted,
            newDate: newDateFormatted,
            newTime: newTimeFormatted,
            actionType,
            mentorName: mentorName || 'A Mentor'
          })

          const sent = await sendEmail({
            to: superMentor.email,
            subject: `📅 Class ${actionType === 'prepone' ? 'Preponed' : 'Postponed'}: ${cohortName} - ${subjectName}`,
            html: emailHtml
          })

          if (sent) {
            superMentorEmailsSent++
            console.log(`✅ Reschedule email sent to super mentor: ${superMentor.email}`)
          }
        }

        // WhatsApp
        const phone = formatPhoneForWhatsApp(superMentor.phone_num)
        if (phone) {
          const waComponents = buildRescheduleWhatsAppForSuperMentor({
            superMentorName: superMentor.name,
            cohortName,
            subjectName,
            originalDateTime: `${origDateFormatted} at ${origTimeFormatted}`,
            newDateTime: `${newDateFormatted} at ${newTimeFormatted}`,
            actionType: actionType === 'prepone' ? 'Preponed' : 'Postponed',
            mentorName: mentorName || 'A Mentor'
          })

          const waSent = await sendWhatsAppMessage({
            to: phone,
            templateName: SUPERMENTOR_WA_TEMPLATE,
            components: waComponents
          })

          if (waSent) {
            superMentorWASent++
            console.log(`✅ Reschedule WhatsApp sent to super mentor: ${phone}`)
          }
        }

        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }

    // ============ SEND TO STUDENTS ============
    if (cohortInfo) {
      const { data: students, error: studentsError } = await supabaseMain
        .from('onboarding')
        .select('Name, Email, Phone')
        .eq('Cohort Type', cohortInfo.type)
        .eq('Cohort Number', cohortInfo.number)

      if (studentsError) {
        console.error('Error fetching students:', studentsError)
      }

      if (students && students.length > 0) {
        console.log(`Sending reschedule notifications to ${students.length} students`)

        for (const student of students) {
          // Email
          if (student.Email && student.Email.includes('@')) {
            const emailHtml = generateRescheduleEmailForStudent({
              studentName: student.Name,
              cohortName,
              subjectName,
              originalDate: origDateFormatted,
              originalTime: origTimeFormatted,
              newDate: newDateFormatted,
              newTime: newTimeFormatted,
              actionType
            })

            const sent = await sendEmail({
              to: student.Email,
              subject: `🔔 Class Rescheduled: ${cohortName} - ${subjectName}`,
              html: emailHtml
            })

            if (sent) {
              studentEmailsSent++
            }
          }

          // WhatsApp
          const phone = formatPhoneForWhatsApp(student.Phone)
          if (phone) {
            const waComponents = buildRescheduleWhatsAppForStudent({
              studentName: student.Name || 'Student',
              cohortName,
              subjectName,
              originalDateTime: `${origDateFormatted} at ${origTimeFormatted}`,
              newDateTime: `${newDateFormatted} at ${newTimeFormatted}`
            })

            const waSent = await sendWhatsAppMessage({
              to: phone,
              templateName: STUDENT_WA_TEMPLATE,
              components: waComponents
            })

            if (waSent) {
              studentWASent++
            }
          }

          // Rate limit: 100ms between student messages
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        console.log(`✅ Student notifications: ${studentEmailsSent} emails, ${studentWASent} WhatsApp`)
      }
    }

    return NextResponse.json({
      success: true,
      message: `Session ${actionType}d successfully`,
      notifications: {
        superMentors: { emails: superMentorEmailsSent, whatsapp: superMentorWASent },
        students: { emails: studentEmailsSent, whatsapp: studentWASent }
      }
    })

  } catch (error: any) {
    console.error('Reschedule error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to reschedule session' },
      { status: 500 }
    )
  }
}

