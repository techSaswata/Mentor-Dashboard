'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import AuthWrapper from '@/components/auth/AuthWrapper'
import { 
  Calendar, Clock, Video, FileText, ArrowLeft, ArrowRight,
  Users, LogOut, Loader2, RefreshCw, Sparkles, Link2, Plus,
  Trash2, Check, ExternalLink, ChevronLeft,
  BookOpen, AlertCircle, Upload, X, Repeat
} from 'lucide-react'

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface SessionDetails {
  id: number
  week_number: number
  session_number: number
  date: string
  time: string
  day: string
  session_type: string
  subject_type: string
  subject_name: string
  subject_topic: string
  initial_session_material: string
  session_material: string
  session_recording: string
  mentor_id: number
  swapped_mentor_id: number | null
  teams_meeting_link: string
  materialLinks: string[]
}

interface Mentor {
  id: number
  name: string
  email: string
}

interface ScheduleRow {
  id: number
  week_number: number
  session_number: number
  date: string | null
  time: string | null
  day: string | null
}

interface SessionPageData {
  table: string
  date: string
  time: string
  batch: string
  from: string
}

function SessionDetailsPage() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  
  // Read from sessionStorage
  const [pageData, setPageData] = useState<SessionPageData | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  
  useEffect(() => {
    const stored = sessionStorage.getItem('sessionPageData')
    if (stored) {
      try {
        setPageData(JSON.parse(stored))
      } catch {
        router.push('/home')
      }
    } else {
      router.push('/home')
    }
    setIsInitialized(true)
  }, [router])

  const tableName = pageData?.table || null
  const date = pageData?.date || null
  const time = pageData?.time || null
  const batchName = pageData?.batch || 'Unknown Batch'
  const fromPage = pageData?.from || 'home'

  const handleBack = () => {
    if (fromPage === 'my-batches') {
      router.push('/my-batches')
    } else {
      router.push('/home')
    }
  }

  // Parse cohort info from table name (e.g., basic1_1_schedule -> Basic, 1.1)
  const parseCohortFromTable = (table: string) => {
    if (!table) return { type: '', number: '' }
    const name = table.replace('_schedule', '')
    // Match pattern like basic1_1, mern2_0, placement3_5
    const match = name.match(/([a-zA-Z]+)(\d+)_(\d+)/)
    if (match) {
      const type = match[1].charAt(0).toUpperCase() + match[1].slice(1)
      const number = `${match[2]}.${match[3]}`
      return { type, number }
    }
    return { type: name, number: '1.0' }
  }

  const handleUploadAttendance = () => {
    const cohortInfo = parseCohortFromTable(tableName || '')
    // Store attendance data in sessionStorage to keep URL clean
    sessionStorage.setItem('attendanceUploadData', JSON.stringify({
      cohortType: cohortInfo.type,
      cohortNumber: cohortInfo.number,
      subject: session?.subject_name || '',
      date: date || '',
      teacher: user?.name || '',
      table: tableName || '',
      batch: batchName,
      time: time || '',
      from: 'session',
      sessionFrom: fromPage
    }))
    router.push('/attendance/upload')
  }

  const [session, setSession] = useState<SessionDetails | null>(null)
  const [allSessions, setAllSessions] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Material form state
  const [newLinks, setNewLinks] = useState<string[]>([''])
  const [savingMaterial, setSavingMaterial] = useState(false)
  const [materialSuccess, setMaterialSuccess] = useState(false)
  const [deletingMaterialIndex, setDeletingMaterialIndex] = useState<number | null>(null)
  
  // Reschedule state - copied from CohortScheduleEditor
  const [showReschedule, setShowReschedule] = useState<'postpone' | 'prepone' | null>(null)
  const [newDateForMove, setNewDateForMove] = useState<string>('')
  const [newTimeForMove, setNewTimeForMove] = useState<string>('')
  const [isMovingSession, setIsMovingSession] = useState(false)

  // Mentor swap state
  const [showSwapMentor, setShowSwapMentor] = useState(false)
  const [mentors, setMentors] = useState<Mentor[]>([])
  const [selectedMentorId, setSelectedMentorId] = useState<number | null>(null)
  const [isSwappingMentor, setIsSwappingMentor] = useState(false)
  const [loadingMentors, setLoadingMentors] = useState(false)

  // Fetch all mentors
  const fetchMentors = async () => {
    setLoadingMentors(true)
    try {
      const response = await fetch('/api/mentors')
      const data = await response.json()
      if (response.ok) {
        setMentors(data.mentors || [])
      }
    } catch (err) {
      console.error('Error fetching mentors:', err)
    } finally {
      setLoadingMentors(false)
    }
  }

  // Handle mentor swap
  const handleSwapMentor = async () => {
    if (!session || !tableName) return

    setIsSwappingMentor(true)
    try {
      const response = await fetch('/api/session/swap-mentor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName,
          sessionId: session.id,
          swappedMentorId: selectedMentorId,
          swappedByName: user?.name || 'Unknown'
        })
      })

      const data = await response.json()
      if (response.ok) {
        // Refresh session data
        await fetchSession()
        setShowSwapMentor(false)
        setSelectedMentorId(null)
      } else {
        // Check if it's a conflict error
        if (data.hasConflict && data.conflictDetails) {
          const conflictList = data.conflictDetails
            .map((c: { batchName: string; subjectName: string }) => `${c.batchName} - ${c.subjectName}`)
            .join('\n')
          alert(`❌ Cannot swap mentor!\n\nThis mentor already has classes at the same time:\n${conflictList}`)
        } else {
          alert(data.error || 'Failed to swap mentor')
        }
      }
    } catch (err) {
      console.error('Error swapping mentor:', err)
      alert('Failed to swap mentor')
    } finally {
      setIsSwappingMentor(false)
    }
  }

  // Open swap modal
  const openSwapMentorModal = () => {
    setShowSwapMentor(true)
    setSelectedMentorId(session?.swapped_mentor_id || null)
    if (mentors.length === 0) {
      fetchMentors()
    }
  }

  // Get current mentor name (either swapped or original)
  const getCurrentMentorName = () => {
    if (session?.swapped_mentor_id) {
      const swappedMentor = mentors.find(m => m.id === session.swapped_mentor_id)
      return swappedMentor?.name || `Mentor #${session.swapped_mentor_id}`
    }
    const originalMentor = mentors.find(m => m.id === session?.mentor_id)
    return originalMentor?.name || user?.name || 'Unknown'
  }

  // Fetch all sessions for the table (needed for date range calculation)
  const fetchAllSessions = async () => {
    if (!tableName) return

    try {
      const response = await fetch(`/api/cohort/schedule?tableName=${tableName}`)
      const data = await response.json()
      if (data.schedule) {
        setAllSessions(data.schedule)
      }
    } catch (err) {
      console.error('Error fetching all sessions:', err)
    }
  }

  const fetchSession = async () => {
    if (!tableName || !date || !time) {
      setError('Missing session parameters')
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const response = await fetch(
        `/api/mentor/session-details?table=${tableName}&date=${date}&time=${time}`
      )
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to fetch session')
        return
      }

      setSession(data.session)
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (pageData) {
      fetchSession()
      fetchAllSessions()
    }
  }, [pageData])

  // Fetch mentors when session loads (if there's a swapped mentor)
  useEffect(() => {
    if (session?.swapped_mentor_id && mentors.length === 0) {
      fetchMentors()
    }
  }, [session?.swapped_mentor_id])

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-IN', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    })
  }

  const formatTime = (timeStr: string) => {
    if (!timeStr) return 'TBD'
    const [hours, minutes] = timeStr.split(':')
    const h = parseInt(hours)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hour12 = h % 12 || 12
    return `${hour12}:${minutes} ${ampm}`
  }

  // Check if session start time has passed
  const isSessionStarted = () => {
    if (!session) return false
    const sessionDate = session.date?.split('T')[0]
    const sessionTime = session.time?.substring(0, 5) || '00:00'
    if (!sessionDate) return false
    
    const sessionDateTime = new Date(`${sessionDate}T${sessionTime}:00`)
    const now = new Date()
    return now >= sessionDateTime
  }

  // Check if current user is the swapped mentor (not the original)
  const isSwappedMentor = () => {
    if (!session || !user?.mentorId) return false
    return session.swapped_mentor_id === parseInt(String(user.mentorId)) && 
           session.mentor_id !== parseInt(String(user.mentorId))
  }

  // Check if session has recording (completed)
  const hasRecording = () => {
    return !!session?.session_recording && session.session_recording.trim() !== ''
  }

  // Transform Graph API recording URL to our streaming endpoint
  const getRecordingUrl = (recordingUrl: string) => {
    // Check if it's a Microsoft Graph API URL
    if (recordingUrl.includes('graph.microsoft.com') && recordingUrl.includes('/recordings/')) {
      // Extract meetingId and recordingId from URL
      // Format: .../onlineMeetings/{meetingId}/recordings/{recordingId}/content
      const match = recordingUrl.match(/onlineMeetings\/([^/]+)\/recordings\/([^/]+)/)
      if (match) {
        const [, meetingId, recordingId] = match
        return `/api/recording/stream?meetingId=${encodeURIComponent(meetingId)}&recordingId=${encodeURIComponent(recordingId)}`
      }
    }
    // Return original URL if not a Graph API URL (e.g., direct SharePoint/OneDrive link)
    return recordingUrl
  }

  // Add material handlers
  const addLinkField = () => setNewLinks([...newLinks, ''])
  const removeLinkField = (index: number) => {
    if (newLinks.length > 1) setNewLinks(newLinks.filter((_, i) => i !== index))
  }
  const updateLink = (index: number, value: string) => {
    const updated = [...newLinks]
    updated[index] = value
    setNewLinks(updated)
  }

  const handleSaveMaterial = async () => {
    const validLinks = newLinks.filter(link => link.trim().length > 0)
    if (validLinks.length === 0) return

    setSavingMaterial(true)
    try {
      const response = await fetch('/api/mentor/session-material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName,
          date,
          time,
          newLinks: validLinks
        })
      })

      if (response.ok) {
        setMaterialSuccess(true)
        setNewLinks([''])
        await fetchSession()
        setTimeout(() => setMaterialSuccess(false), 3000)
      }
    } catch (err) {
      console.error('Error saving material:', err)
    } finally {
      setSavingMaterial(false)
    }
  }

  const handleDeleteMaterial = async (indexToDelete: number) => {
    if (!session || !tableName) return
    
    const confirmDelete = confirm('Are you sure you want to delete this material?')
    if (!confirmDelete) return

    const linkToDelete = session.materialLinks[indexToDelete]
    if (!linkToDelete) return

    setDeletingMaterialIndex(indexToDelete)
    try {
      const response = await fetch('/api/mentor/session-material', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName,
          date,
          time,
          linkToDelete
        })
      })

      if (response.ok) {
        await fetchSession()
      } else {
        alert('Failed to delete material')
      }
    } catch (err) {
      console.error('Error deleting material:', err)
      alert('Failed to delete material')
    } finally {
      setDeletingMaterialIndex(null)
    }
  }

  // Helper to format date as YYYY-MM-DD in local timezone (from CohortScheduleEditor)
  const formatDateLocal = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Get the next session for date validation (from CohortScheduleEditor)
  const getNextSession = (currentRow: SessionDetails): ScheduleRow | null => {
    const sortedSessions = [...allSessions].sort((a, b) => {
      const weekDiff = (a.week_number || 0) - (b.week_number || 0)
      if (weekDiff !== 0) return weekDiff
      return (a.session_number || 0) - (b.session_number || 0)
    })

    const currentIndex = sortedSessions.findIndex(row => row.id === currentRow.id)
    
    if (currentIndex >= 0 && currentIndex < sortedSessions.length - 1) {
      return sortedSessions[currentIndex + 1]
    }

    return null
  }

  // Get the previous session for minimum date (from CohortScheduleEditor)
  const getPreviousSession = (currentRow: SessionDetails): ScheduleRow | null => {
    const sortedSessions = [...allSessions].sort((a, b) => {
      const weekDiff = (a.week_number || 0) - (b.week_number || 0)
      if (weekDiff !== 0) return weekDiff
      return (a.session_number || 0) - (b.session_number || 0)
    })

    const currentIndex = sortedSessions.findIndex(row => row.id === currentRow.id)
    
    if (currentIndex > 0) {
      return sortedSessions[currentIndex - 1]
    }

    return null
  }

  // Get available dates for postpone - dates after current session (from CohortScheduleEditor)
  const getPostponeDates = (): string[] => {
    if (!session) return []
    
    const sessionDate = new Date(String(session.date).split('T')[0] + 'T12:00:00')
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Get next session's date as upper limit
    const nextSession = getNextSession(session)
    let maxDate: Date
    if (nextSession && nextSession.date) {
      maxDate = new Date(String(nextSession.date).split('T')[0] + 'T12:00:00')
      maxDate.setDate(maxDate.getDate() - 1)
    } else {
      maxDate = new Date(sessionDate)
      maxDate.setDate(maxDate.getDate() + 30)
    }

    // Get existing dates to exclude
    const existingDates = new Set(
      allSessions
        .filter(s => s.id !== session.id && s.date)
        .map(s => String(s.date).split('T')[0])
    )

    const dates: string[] = []
    let currentDate = new Date(Math.max(sessionDate.getTime() + 86400000, today.getTime()))
    
    while (currentDate <= maxDate) {
      const dateStr = formatDateLocal(currentDate)
      if (!existingDates.has(dateStr)) {
        dates.push(dateStr)
      }
      currentDate.setDate(currentDate.getDate() + 1)
    }

    return dates
  }

  // Get available dates for prepone - dates before current session (from CohortScheduleEditor)
  const getPreponeDates = (): string[] => {
    if (!session) return []
    
    const sessionDate = new Date(String(session.date).split('T')[0] + 'T12:00:00')
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Get previous session's date as lower limit
    const prevSession = getPreviousSession(session)
    let minDate: Date
    if (prevSession && prevSession.date) {
      minDate = new Date(String(prevSession.date).split('T')[0] + 'T12:00:00')
      minDate.setDate(minDate.getDate() + 1)
    } else {
      minDate = new Date(sessionDate)
      minDate.setDate(minDate.getDate() - 30)
    }

    // Ensure minDate is not before today
    if (minDate < today) {
      minDate = today
    }

    // Get existing dates to exclude
    const existingDates = new Set(
      allSessions
        .filter(s => s.id !== session.id && s.date)
        .map(s => String(s.date).split('T')[0])
    )

    const dates: string[] = []
    let currentDate = new Date(minDate)
    const maxDate = new Date(sessionDate)
    maxDate.setDate(maxDate.getDate() - 1)
    
    while (currentDate <= maxDate) {
      const dateStr = formatDateLocal(currentDate)
      if (!existingDates.has(dateStr)) {
        dates.push(dateStr)
      }
      currentDate.setDate(currentDate.getDate() + 1)
    }

    return dates
  }

  // Get current session's time for placeholder (from CohortScheduleEditor)
  const getSelectedSessionTime = (): string => {
    return session?.time || ''
  }

  // Get current session's date
  const getSelectedSessionDate = (): string => {
    return session?.date?.split('T')[0] || ''
  }

  // Validate time for postpone/prepone when date is unchanged (from CohortScheduleEditor)
  const isTimeValidForMove = (newTime: string, mode: 'postpone' | 'prepone'): boolean => {
    const currentTime = getSelectedSessionTime()?.substring(0, 5)
    if (!currentTime || !newTime) return true
    
    const [currHour, currMin] = currentTime.split(':').map(Number)
    const [newHour, newMin] = newTime.split(':').map(Number)
    const currMinutes = currHour * 60 + currMin
    const newMinutes = newHour * 60 + newMin
    
    if (mode === 'prepone') {
      return newMinutes < currMinutes
    } else {
      return newMinutes > currMinutes
    }
  }

  // Get time constraints for display (from CohortScheduleEditor)
  const getTimeConstraintText = (mode: 'postpone' | 'prepone'): string => {
    const currentTime = getSelectedSessionTime()?.substring(0, 5)
    if (!currentTime) return ''
    
    if (mode === 'prepone') {
      return `Select time before ${currentTime}`
    } else {
      return `Select time after ${currentTime}`
    }
  }

  // Handle session move (postpone/prepone) - from CohortScheduleEditor
  const handleMoveSession = async (type: 'postpone' | 'prepone') => {
    if (!session) return

    const currentDate = getSelectedSessionDate()
    const currentTime = getSelectedSessionTime()?.substring(0, 5) || ''
    const effectiveDate = newDateForMove || currentDate
    const effectiveTime = newTimeForMove || currentTime

    // Check if anything changed
    const dateChanged = effectiveDate !== currentDate
    const timeChanged = effectiveTime !== currentTime

    if (!dateChanged && !timeChanged) {
      alert('Please change either date or time')
      return
    }

    // If only time changed (same date), validate time direction
    if (!dateChanged && timeChanged) {
      if (!isTimeValidForMove(effectiveTime, type)) {
        if (type === 'prepone') {
          alert(`For prepone on same date, time must be before ${currentTime}`)
        } else {
          alert(`For postpone on same date, time must be after ${currentTime}`)
        }
        return
      }
    }

    setIsMovingSession(true)

    try {
      // Call the new reschedule API which handles DB updates + notifications
      const response = await fetch('/api/session/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName,
          sessionId: session.id,
          originalDate: currentDate,
          originalTime: currentTime,
          newDate: effectiveDate,
          newTime: timeChanged ? effectiveTime : null,
          actionType: type,
          mentorName: user?.name || 'A Mentor'
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reschedule')
      }

      console.log('Reschedule result:', data)

      // Navigate to the new session page
      sessionStorage.setItem('sessionPageData', JSON.stringify({
        table: tableName,
        date: effectiveDate,
        time: effectiveTime,
        batch: batchName,
        from: pageData?.from || 'home'
      }))
      router.replace('/session')
      setShowReschedule(null)
      setNewDateForMove('')
      setNewTimeForMove('')

      // Refresh the page data
      setTimeout(() => {
        window.location.reload()
      }, 100)

    } catch (err: any) {
      console.error(`Error ${type}ing session:`, err)
      alert(err.message || `Failed to ${type} session`)
    } finally {
      setIsMovingSession(false)
    }
  }

  // Reset move selections when closing modal
  const resetMoveSelections = () => {
    setNewDateForMove('')
    setNewTimeForMove('')
    setShowReschedule(null)
  }

  if (!isInitialized || loading || !pageData) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center">
        {/* Background */}
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-slate-950 to-indigo-950/20" />
        </div>
        {/* Spinning rings */}
        <div className="relative z-10 mb-6">
          <div className="w-20 h-20 rounded-full border-4 border-transparent border-t-violet-500 border-r-indigo-500 animate-spin" />
          <div className="absolute inset-1.5 w-[62px] h-[62px] rounded-full border-4 border-transparent border-b-cyan-400 border-l-purple-500 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-violet-500/50 animate-pulse">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>
        <p className="relative z-10 text-slate-400 text-sm">Loading session details...</p>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl text-white mb-2">Session Not Found</h2>
          <p className="text-slate-400 mb-4">{error}</p>
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-violet-500 text-white rounded-lg"
          >
            Go Back
          </button>
        </div>
      </div>
    )
  }

  const postponeDates = getPostponeDates()
  const preponeDates = getPreponeDates()

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-slate-950 to-indigo-950/20" />
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-violet-600/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-indigo-600/5 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-slate-950/50 backdrop-blur-xl sticky top-0">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={handleBack}
              className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
              <span>{fromPage === 'my-batches' ? 'Back to My Batches' : 'Back to Home'}</span>
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-xl flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-bold text-white">Session Details</h1>
                <p className="text-slate-500 text-xs">{batchName}</p>
              </div>
            </div>

            <button
              onClick={signOut}
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Session Header Card */}
        <div className="bg-gradient-to-br from-violet-600/20 via-indigo-600/10 to-slate-900/50 border border-violet-500/20 rounded-2xl p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
            <div>
              <span className="inline-block px-3 py-1 bg-violet-500/20 text-violet-300 text-sm rounded-lg font-medium mb-3">
                {batchName}
              </span>
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                {session.subject_name || 'Session'}
              </h2>
              <p className="text-slate-400">{session.subject_topic || 'No topic specified'}</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={fetchSession}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Calendar className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wide">Date</span>
              </div>
              <p className="text-white font-medium">{formatDate(session.date)}</p>
            </div>

            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Clock className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wide">Time</span>
              </div>
              <p className="text-white font-medium">{formatTime(session.time)}</p>
            </div>

            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <BookOpen className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wide">Type</span>
              </div>
              <p className="text-white font-medium">{session.session_type || 'Regular'}</p>
            </div>

            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-2 text-slate-400 mb-1">
                <Users className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wide">Subject Type</span>
              </div>
              <p className="text-white font-medium">{session.subject_type || 'General'}</p>
            </div>
          </div>

          {/* Join Button */}
          {session.teams_meeting_link ? (
            <a
              href={session.teams_meeting_link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-semibold rounded-xl transition-all shadow-lg shadow-emerald-500/20"
            >
              <Video className="w-5 h-5" />
              Join Meeting
            </a>
          ) : (
            <div className="mt-6 w-full flex items-center justify-center gap-2 px-6 py-3 bg-slate-700/50 text-slate-400 font-medium rounded-xl">
              <Video className="w-5 h-5" />
              No Meeting Link Yet
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {!isSessionStarted() && (
            <button
              onClick={() => {
                setShowReschedule('prepone')
                setNewDateForMove('')
                setNewTimeForMove('')
              }}
              className="flex items-center justify-center gap-2 px-3 py-3 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 hover:border-cyan-500/50 text-cyan-400 rounded-xl transition-all group"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="font-medium text-sm">Prepone</span>
            </button>
          )}
          
          <button
            onClick={handleUploadAttendance}
            className="flex items-center justify-center gap-2 px-3 py-3 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 hover:border-blue-500/50 text-blue-400 rounded-xl transition-all group"
          >
            <Upload className="w-4 h-4" />
            <span className="font-medium text-sm">Attendance</span>
          </button>

          {!isSwappedMentor() && !hasRecording() && (
            <button
              onClick={openSwapMentorModal}
              className="flex items-center justify-center gap-2 px-3 py-3 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 hover:border-purple-500/50 text-purple-400 rounded-xl transition-all group"
            >
              <Users className="w-4 h-4" />
              <span className="font-medium text-sm">Swap Mentor</span>
            </button>
          )}
          
          {!hasRecording() && (
            <button
              onClick={() => {
                setShowReschedule('postpone')
                setNewDateForMove('')
                setNewTimeForMove('')
              }}
              className="flex items-center justify-center gap-2 px-3 py-3 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 hover:border-orange-500/50 text-orange-400 rounded-xl transition-all group"
            >
              <span className="font-medium text-sm">Postpone</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Swapped Mentor Indicator */}
        {session?.swapped_mentor_id && (
          <div className="mb-6 p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/20 rounded-lg">
                  <Users className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-purple-300 text-sm font-medium">Mentor Swapped</p>
                  <p className="text-purple-400 text-xs">
                    Assigned to: <span className="font-semibold text-purple-300">
                      {loadingMentors ? 'Loading...' : (mentors.find(m => m.id === session.swapped_mentor_id)?.name || `Mentor #${session.swapped_mentor_id}`)}
                    </span>
                  </p>
                </div>
              </div>
              {!isSessionStarted() && (
                <button
                  onClick={() => {
                    setSelectedMentorId(null)
                    handleSwapMentor()
                  }}
                  className="px-3 py-1.5 text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg transition-colors"
                >
                  Remove Swap
                </button>
              )}
            </div>
          </div>
        )}

        {/* Reschedule Modal - copied from CohortScheduleEditor */}
        {showReschedule && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={resetMoveSelections} />
            <div className="relative w-full max-w-lg bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden">
              {/* Modal Header */}
              <div className={`px-6 py-5 border-b border-slate-700/50 ${
                showReschedule === 'postpone' 
                  ? 'bg-gradient-to-r from-orange-500/10 to-amber-500/10' 
                  : 'bg-gradient-to-r from-cyan-500/10 to-blue-500/10'
              }`}>
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-xl ${
                    showReschedule === 'postpone' 
                      ? 'bg-orange-500/10' 
                      : 'bg-cyan-500/10'
                  }`}>
                    {showReschedule === 'postpone' ? (
                      <ArrowRight className="h-6 w-6 text-orange-400" />
                    ) : (
                      <ArrowLeft className="h-6 w-6 text-cyan-400" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      {showReschedule === 'postpone' ? 'Postpone Class' : 'Prepone Class'}
                    </h3>
                    <p className="text-sm text-slate-400">
                      {showReschedule === 'postpone' 
                        ? 'Move this session to a later date'
                        : 'Move this session to an earlier date'
                      }
                    </p>
                  </div>
                </div>
              </div>

              {/* Modal Body */}
              <div className="p-6 space-y-6">
                {/* Current Session Info */}
                <div className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-xl">
                  <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Current Schedule</p>
                  <p className="text-white font-medium">{session.subject_name}</p>
                  <p className="text-slate-400 text-sm mt-1">
                    {formatDate(session.date)} at {formatTime(session.time)}
                  </p>
                </div>

                {/* Date & Time Selection - copied from CohortScheduleEditor */}
                <div className={`space-y-4 p-4 border rounded-xl ${
                  showReschedule === 'postpone' 
                    ? 'bg-orange-500/5 border-orange-500/30' 
                    : 'bg-cyan-500/5 border-cyan-500/30'
                }`}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Date Selection */}
                    <div className="space-y-2">
                      <label className={`block text-sm font-medium ${
                        showReschedule === 'postpone' ? 'text-orange-400' : 'text-cyan-400'
                      }`}>
                        New Date ({showReschedule === 'postpone' ? postponeDates.length : preponeDates.length} available)
                      </label>
                      {(showReschedule === 'postpone' ? postponeDates.length > 0 : preponeDates.length > 0) ? (
                        <select
                          value={newDateForMove}
                          onChange={(e) => setNewDateForMove(e.target.value)}
                          className={`w-full px-4 py-3 bg-slate-800/50 border rounded-xl focus:outline-none focus:ring-2 text-white ${
                            showReschedule === 'postpone' 
                              ? 'border-orange-500/50 focus:ring-orange-500' 
                              : 'border-cyan-500/50 focus:ring-cyan-500'
                          }`}
                        >
                          <option value="">Keep current date</option>
                          {(showReschedule === 'postpone' ? postponeDates : preponeDates).map(d => {
                            const dateObj = new Date(d + 'T12:00:00')
                            const dayName = DAYS_OF_WEEK[dateObj.getDay()]
                            const formatted = dateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                            return <option key={d} value={d}>{formatted} ({dayName})</option>
                          })}
                        </select>
                      ) : (
                        <p className="text-sm text-amber-400 py-3">
                          No {showReschedule === 'postpone' ? 'later' : 'earlier'} dates available
                        </p>
                      )}
                      <p className="text-xs text-slate-500">
                        Current: {new Date(getSelectedSessionDate() + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>

                    {/* Time Selection */}
                    <div className="space-y-2">
                      <label className={`block text-sm font-medium ${
                        showReschedule === 'postpone' ? 'text-orange-400' : 'text-cyan-400'
                      }`}>
                        New Time
                      </label>
                      <input
                        type="time"
                        value={newTimeForMove || getSelectedSessionTime()?.substring(0, 5) || ''}
                        onChange={(e) => setNewTimeForMove(e.target.value)}
                        className={`w-full px-4 py-3 bg-slate-800/50 border rounded-xl focus:outline-none focus:ring-2 text-white ${
                          showReschedule === 'postpone' 
                            ? 'border-orange-500/50 focus:ring-orange-500' 
                            : 'border-cyan-500/50 focus:ring-cyan-500'
                        }`}
                      />
                      {!newDateForMove && (
                        <p className="text-xs text-amber-400">
                          {getTimeConstraintText(showReschedule)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Note */}
                <p className="text-xs text-slate-500">
                  Note: The meeting link will be cleared and a new one will need to be generated.
                </p>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-slate-700/50 flex gap-3">
                <button
                  onClick={resetMoveSelections}
                  className="flex-1 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-xl transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleMoveSession(showReschedule)}
                  disabled={isMovingSession}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    showReschedule === 'postpone' 
                      ? 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white'
                      : 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white'
                  }`}
                >
                  {isMovingSession ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      {showReschedule === 'postpone' ? 'Postponing...' : 'Preponing...'}
                    </>
                  ) : (
                    <>
                      {showReschedule === 'postpone' ? (
                        <ArrowRight className="h-5 w-5" />
                      ) : (
                        <ArrowLeft className="h-5 w-5" />
                      )}
                      {showReschedule === 'postpone' ? 'Postpone Session' : 'Prepone Session'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Swap Mentor Modal */}
        {showSwapMentor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowSwapMentor(false)} />
            <div className="relative w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden">
              {/* Modal Header */}
              <div className="px-6 py-5 border-b border-slate-700/50 bg-gradient-to-r from-purple-500/10 to-pink-500/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-purple-500/10">
                      <Users className="h-6 w-6 text-purple-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white">Swap Mentor</h3>
                      <p className="text-sm text-slate-400">Assign this class to a different mentor</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowSwapMentor(false)}
                    className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="p-6 space-y-4">
                {/* Current Assignment */}
                <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
                  <p className="text-slate-400 text-sm mb-1">Current Mentor</p>
                  <p className="text-white font-medium">{user?.name || 'Unknown'}</p>
                  {session?.swapped_mentor_id && (
                    <p className="text-purple-400 text-xs mt-1">
                      Currently swapped to: {mentors.find(m => m.id === session.swapped_mentor_id)?.name || `Mentor #${session.swapped_mentor_id}`}
                    </p>
                  )}
                </div>

                {/* Mentor Selection */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Select New Mentor
                  </label>
                  {loadingMentors ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
                    </div>
                  ) : (
                    <select
                      value={selectedMentorId || ''}
                      onChange={(e) => setSelectedMentorId(e.target.value ? Number(e.target.value) : null)}
                      className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50"
                    >
                      <option value="">Select a mentor...</option>
                      {mentors
                        .filter(m => m.id !== session?.mentor_id) // Exclude original mentor
                        .map(mentor => (
                          <option key={mentor.id} value={mentor.id} className="bg-slate-800">
                            {mentor.name} ({mentor.email})
                          </option>
                        ))}
                    </select>
                  )}
                </div>

                {/* Note */}
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <p className="text-amber-300 text-xs">
                    ⚠️ Supermentors will be auto-informed about the swap.
                  </p>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-slate-700/50 bg-slate-800/30 flex gap-3">
                <button
                  onClick={() => setShowSwapMentor(false)}
                  className="flex-1 px-4 py-2.5 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSwapMentor}
                  disabled={!selectedMentorId || isSwappingMentor}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSwappingMentor ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Swapping...
                    </>
                  ) : (
                    'Confirm Swap'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Session Materials Section */}
        <div className="bg-slate-900/50 border border-white/5 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/5">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-violet-400" />
              Session Materials
            </h3>
          </div>

          <div className="p-6 space-y-6">
            {/* Existing Materials */}
            {session.materialLinks && session.materialLinks.length > 0 ? (
              <div>
                <p className="text-sm font-medium text-slate-300 mb-3">Added Materials</p>
                <div className="space-y-2">
                  {session.materialLinks.map((link, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2"
                    >
                      <a
                        href={link.startsWith('http') ? link : `https://${link}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center gap-3 px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-xl text-blue-400 hover:text-blue-300 hover:border-blue-500/30 transition-colors group"
                      >
                        <Link2 className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate flex-1">{link}</span>
                        <ExternalLink className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </a>
                      <button
                        onClick={() => handleDeleteMaterial(index)}
                        disabled={deletingMaterialIndex === index}
                        className="p-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 text-red-400 rounded-xl transition-colors disabled:opacity-50"
                        title="Delete material"
                      >
                        {deletingMaterialIndex === index ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-slate-400 mb-1">No materials added yet</p>
                <p className="text-slate-500 text-sm">Add links to slides, notes, or resources</p>
              </div>
            )}

            {/* Add New Materials */}
            <div className="border-t border-slate-700/50 pt-6">
              <p className="text-sm font-medium text-slate-300 mb-3">Add New Materials</p>
              <div className="space-y-3">
                {newLinks.map((link, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="flex-1 relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Link2 className="w-4 h-4 text-slate-500" />
                      </div>
                      <input
                        type="url"
                        value={link}
                        onChange={(e) => updateLink(index, e.target.value)}
                        placeholder="https://drive.google.com/..."
                        className="w-full pl-10 pr-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-sm"
                      />
                    </div>
                    {newLinks.length > 1 && (
                      <button
                        onClick={() => removeLinkField(index)}
                        className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between mt-4">
                <button
                  onClick={addLinkField}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Another Link
                </button>

                <button
                  onClick={handleSaveMaterial}
                  disabled={savingMaterial || newLinks.every(l => !l.trim())}
                  className="flex items-center gap-2 px-4 py-2 bg-violet-500 hover:bg-violet-400 disabled:bg-slate-700 text-white font-medium text-sm rounded-lg transition-colors disabled:cursor-not-allowed"
                >
                  {savingMaterial ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : materialSuccess ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                  {materialSuccess ? 'Saved!' : 'Save Materials'}
                </button>
              </div>
            </div>

            {/* Recording Link */}
            {session.session_recording && (
              <div className="border-t border-slate-700/50 pt-6">
                <p className="text-sm font-medium text-slate-300 mb-3">Session Recording</p>
                <a
                  href={getRecordingUrl(session.session_recording)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 hover:text-emerald-300 transition-colors group"
                >
                  <Video className="w-5 h-5" />
                  <span>View Recording</span>
                  <ExternalLink className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

export default function SessionPageWrapper() {
  return (
    <AuthWrapper>
      <SessionDetailsPage />
    </AuthWrapper>
  )
}
