import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use DB B for everything (mentor check + auth)
const supabaseB = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_B!,
  process.env.SUPABASE_SERVICE_ROLE_KEY_B!
)

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Check if email exists in Mentor Details table (DB B)
    const { data: mentor, error: mentorError } = await supabaseB
      .from('Mentor Details')
      .select('mentor_id, Name, "Email address"')
      .ilike('Email address', normalizedEmail)
      .single()

    if (mentorError || !mentor) {
      return NextResponse.json(
        { error: 'Only registered mentors can access this dashboard.' },
        { status: 404 }
      )
    }

    // Get the redirect URL from the request origin - redirect to /home after login
    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const redirectUrl = `${origin}/home`
    
    // Send magic link via Supabase B
    const { error: signInError } = await supabaseB.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          role: 'mentor',
          mentor_id: mentor.mentor_id,
          mentor_name: mentor.Name
        }
      }
    })

    if (signInError) {
      console.error('Supabase B magic link error:', signInError)
      return NextResponse.json(
        { error: 'Failed to send verification link. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Verification link sent successfully',
      mentorName: mentor.Name
    })

  } catch (error: any) {
    console.error('Magic link error:', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
