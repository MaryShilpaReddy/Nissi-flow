import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import './App.css'
import { Layout, Typography, Input, Button, Divider, Card, Space, Checkbox, Select, FloatButton, DatePicker } from 'antd'
import { SendOutlined, PlusOutlined, SmileOutlined, CodeOutlined, ProfileOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons'

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string }
const uid = () => Math.random().toString(36).slice(2, 10)

type TaskCard = {
  id: string
  title: string
  description: string
  estimate: string
  deadline: string
  done: boolean
  notes: string
  hidden: boolean
  status?: 'new' | 'started'
  parentId?: string
  subtasks: { id: string; title: string; done: boolean; estimate: string; notes: string }[]
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [note, setNote] = useState('')
  const [goal, setGoal] = useState('')
  const [context, setContext] = useState('')
  const [taskType, setTaskType] = useState<'dev' | 'custom'>('custom')
  
  const [showMoodPanel, setShowMoodPanel] = useState(false)
  const [showBreakdownPanel, setShowBreakdownPanel] = useState(false)
  // Draft states removed; inputs live directly in cards when visible
  // Hover state removed in favor of AntD tooltips
  const [tasks, setTasks] = useState<string[]>([])
  const [tasksProgress, setTasksProgress] = useState(0)
  const [tasksTotal, setTasksTotal] = useState(0)
  const [showRightBreakdown, setShowRightBreakdown] = useState(false)
  const [createdTasks, setCreatedTasks] = useState<string[]>([])
  const [createdListName, setCreatedListName] = useState<string>('')
  // When set, AI-generated breakdown is applied as subtasks to this card
  const [subtasksTargetCardId, setSubtasksTargetCardId] = useState<string | null>(null)
  // Assistant focus/thread view
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  // (reserved) thread state for future subtasks flow
  const [isEditingListName, setIsEditingListName] = useState(false)
  const [pendingListName, setPendingListName] = useState('')
  const [activeView, setActiveView] = useState<'dashboard' | 'assistant'>('dashboard')
  const [taskCards, setTaskCards] = useState<TaskCard[]>([])
  // Dashboard dev-create fields
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskEstimate, setNewTaskEstimate] = useState('')
  const [newTaskDeadline, setNewTaskDeadline] = useState('')
  const [showDevCreateCard, setShowDevCreateCard] = useState(false)
  const [devCreateCanStart, setDevCreateCanStart] = useState(false)
  const [devCreateLastTaskId, setDevCreateLastTaskId] = useState<string | null>(null)
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({})
  const { toggleDone, updateEstimate, updateDeadline, updateNotes, hideCard, beginAddSubtask, addSubtask, toggleSubtask } =
    useTaskCardHelpers(setTaskCards, subtaskDrafts, setSubtaskDrafts)
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [editingDetailsId, setEditingDetailsId] = useState<string | null>(null)
  const [detailsEstimateDraft, setDetailsEstimateDraft] = useState('')
  const [detailsDeadlineDraft, setDetailsDeadlineDraft] = useState('')
  const [carouselTaskId, setCarouselTaskId] = useState<string | null>(null)
  const [carouselIndex, setCarouselIndex] = useState(0)
  const carouselTask = useMemo(() => taskCards.find((t) => t.id === carouselTaskId) ?? null, [taskCards, carouselTaskId])
  const carouselTotal = useMemo(() => (carouselTask ? carouselTask.subtasks.length : 0), [carouselTask])
  const carouselCurrent = useMemo(
    () => (carouselTask && carouselTotal > 0 ? carouselTask.subtasks[carouselIndex] : null),
    [carouselTask, carouselIndex, carouselTotal],
  )
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [pendingCreateFromBreakdown, setPendingCreateFromBreakdown] = useState(false)
  const [pendingClarify, setPendingClarify] = useState(false)
  const [clarifyQuestions, setClarifyQuestions] = useState<string[]>([])
  const [clarifyStep, setClarifyStep] = useState(0)
  const [clarifyAnswers, setClarifyAnswers] = useState<string[]>([])
  const originalContextRef = useRef<string>('')
  const lastClarifyKeyRef = useRef<string>('')
  const [mood, setMood] = useState<{ mood: string; motivation: number; suggestion: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)
  const lastBreakdownToken = useRef<number>(0)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const canSend = useMemo(() => input.trim().length > 0, [input])

  function parseClarifyRaw(raw: string): string[] {
    const trimmed = (raw || '').trim()
    if (!trimmed) return []
    // Try JSON first
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean)
      if (parsed && Array.isArray((parsed as any).questions)) {
        return (parsed as any).questions.map((x: any) => String(x)).filter(Boolean)
      }
    } catch {}
    // Try to split numbered/bulleted questions
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    // If we find explicit bullets or numbers, collect those
    const bullets: string[] = []
    for (const l of lines) {
      const cleaned = l.replace(/^\s*[\-*•\d]+[\.)]?\s+/, '').trim()
      // skip headings
      if (/^here are/i.test(cleaned)) continue
      if (/^the (current state|goals|technical environment)/i.test(cleaned)) continue
      if (cleaned.length >= 3 && cleaned.length <= 240) bullets.push(cleaned)
      if (bullets.length >= 7) break
    }
    if (bullets.length > 0) return bullets
    // Fallback: split on double newlines as paragraphs
    const paras = trimmed
      .split(/\n\s*\n+/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter((p) => p.length > 0 && p.length <= 300)
    if (paras.length > 0) return paras.slice(0, 5)
    return []
  }

  // Clarifying questions now come exclusively from the AI response (no static/local fallbacks)

  // (legacy buildComprehensiveContext removed; now using createIntelligentTaskQuery)

  // Removed unused createEnhancedTaskPrompt (superseded by createIntelligentTaskQuery)

  /**
   * Enhanced function to generate tasks using all user answers and context
   * This function creates a comprehensive prompt that leverages all the information
   * gathered from clarifying questions to generate more relevant and actionable tasks.
   * 
   * @param goal - The primary goal or objective
   * @param context - Initial context provided by the user
   * @param note - Additional notes or requirements
   * @param taskType - Whether this is a development or custom task
   * @param questions - Array of clarifying questions asked
   * @param answers - Array of user's answers to the questions
   * @returns Promise<string[]> - Array of generated tasks
   */
  async function generateTasksFromAnswers(goal: string, context: string, note: string, taskType: 'dev' | 'custom', questions: string[], answers: string[]): Promise<string[]> {
    // Rich context assembled via createIntelligentTaskQuery
    // Create a more sophisticated prompt that leverages all the gathered information
    const enhancedPrompt = createIntelligentTaskQuery(goal, context, note, taskType, questions, answers)

    try {
      // Use the AI chat function with the enhanced prompt
      const response = await window.ai.chat([
        { role: 'system', content: 'You are an expert project planner. Generate only the task list, no additional text.' },
        { role: 'user', content: enhancedPrompt }
      ])
      
      // Parse the response into individual tasks
      const tasks = response
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('-') && !line.startsWith('*') && !line.match(/^\d+\./))
        .slice(0, 8) // Limit to 8 tasks maximum
      
      return tasks
    } catch (error) {
      console.error('Error generating tasks from answers:', error)
      
      // Enhanced fallback with better error handling
      try {
        console.log('Attempting fallback to original breakdown method...')
        const fallbackTasks = await window.ai.breakdown(goal, context, taskType)
        console.log('Fallback tasks generated:', fallbackTasks)
        return fallbackTasks
      } catch (fallbackError) {
        console.error('Fallback method also failed:', fallbackError)
        
        // Generate basic fallback tasks based on the goal
        const basicTasks = [
          `Define requirements for: ${goal}`,
          `Plan approach for: ${goal}`,
          `Implement core functionality for: ${goal}`,
          `Test and validate: ${goal}`,
          `Document and deploy: ${goal}`
        ]
        
        console.log('Using basic fallback tasks:', basicTasks)
        return basicTasks
      }
    }
  }

  /**
   * Function to analyze user answers and create contextual insights
   * This function analyzes the user's responses to identify patterns and requirements
   * that can be used to create more targeted and relevant task generation prompts.
   * 
   * @param questions - Array of clarifying questions asked
   * @param answers - Array of user's answers to the questions
   * @returns Object containing analysis of technical complexity, timeline sensitivity, resource constraints, and key requirements
   */
  function analyzeUserAnswers(questions: string[], answers: string[]): {
    technicalComplexity: 'low' | 'medium' | 'high'
    timelineSensitivity: boolean
    resourceConstraints: boolean
    keyRequirements: string[]
  } {
    const allText = (questions.join(' ') + ' ' + answers.join(' ')).toLowerCase()
    
    // Analyze technical complexity
    const technicalTerms = /(framework|library|api|database|file|component|function|class|method|test|deploy|build|config|architecture|infrastructure)/g
    const technicalMatches = allText.match(technicalTerms) || []
    let technicalComplexity: 'low' | 'medium' | 'high' = 'low'
    if (technicalMatches.length > 5) technicalComplexity = 'high'
    else if (technicalMatches.length > 2) technicalComplexity = 'medium'
    
    // Analyze timeline sensitivity
    const timelineTerms = /(deadline|urgent|asap|quick|fast|time|schedule|due date|priority)/g
    const timelineSensitivity = timelineTerms.test(allText)
    
    // Analyze resource constraints
    const resourceTerms = /(budget|limited|constraint|resource|team|skill|experience|tool|software|hardware)/g
    const resourceConstraints = resourceTerms.test(allText)
    
    // Extract key requirements
    const keyRequirements = answers
      .filter(answer => answer.length > 10)
      .map(answer => answer.trim())
      .slice(0, 3) // Top 3 most detailed answers
    
    return {
      technicalComplexity,
      timelineSensitivity,
      resourceConstraints,
      keyRequirements
    }
  }

  // Function to create a comprehensive summary of user answers for better AI context
  function createUserAnswersSummary(questions: string[], answers: string[]): string {
    const analysis = analyzeUserAnswers(questions, answers)
    
    let summary = 'User Input Analysis:\n'
    summary += `- Technical Complexity: ${analysis.technicalComplexity}\n`
    summary += `- Timeline Sensitivity: ${analysis.timelineSensitivity ? 'Yes' : 'No'}\n`
    summary += `- Resource Constraints: ${analysis.resourceConstraints ? 'Yes' : 'No'}\n`
    
    if (analysis.keyRequirements.length > 0) {
      summary += `- Key Requirements: ${analysis.keyRequirements.join(', ')}\n`
    }
    
    summary += '\nDetailed Q&A:\n'
    questions.forEach((question, index) => {
      const answer = answers[index] || 'Not specified'
      summary += `Q: ${question}\nA: ${answer}\n\n`
    })
    
    return summary.trim()
  }

  // Function to log task generation process for debugging and improvement
  function logTaskGeneration(goal: string, context: string, note: string, taskType: 'dev' | 'custom', questions: string[], answers: string[], generatedTasks: string[]): void {
    const logData = {
      timestamp: new Date().toISOString(),
      goal,
      context,
      note,
      taskType,
      questions,
      answers,
      analysis: analyzeUserAnswers(questions, answers),
      generatedTasks,
      promptUsed: createIntelligentTaskQuery(goal, context, note, taskType, questions, answers)
    }
    
    console.log('Task Generation Log:', logData)
    
    // In a production environment, you might want to send this to a logging service
    // or save it locally for analysis and improvement
  }

  /**
   * Helper function to create intelligent task generation queries
   * This function creates sophisticated prompts that leverage the analysis of user answers
   * to generate more contextual and relevant task breakdowns.
   * 
   * @param goal - The primary goal or objective
   * @param context - Initial context provided by the user
   * @param note - Additional notes or requirements
   * @param taskType - Whether this is a development or custom task
   * @param questions - Array of clarifying questions asked
   * @param answers - Array of user's answers to the questions
   * @returns String containing the enhanced prompt for task generation
   */
  function createIntelligentTaskQuery(goal: string, context: string, note: string, taskType: 'dev' | 'custom', questions: string[], answers: string[]): string {
    // Use the enhanced analysis function
    const analysis = analyzeUserAnswers(questions, answers)
    
    // Build a context-aware query based on the analysis
    let queryFocus = ''
    if (analysis.technicalComplexity === 'high') queryFocus += 'Focus on detailed technical implementation and architecture, '
    else if (analysis.technicalComplexity === 'medium') queryFocus += 'Focus on technical implementation details, '
    else queryFocus += 'Focus on practical, actionable steps, '
    
    if (analysis.timelineSensitivity) queryFocus += 'Prioritize timeline and dependencies, '
    if (analysis.resourceConstraints) queryFocus += 'Account for available resources and constraints, '
    
    // Create a comprehensive prompt that includes all the user's answers
    const userAnswersSummary = createUserAnswersSummary(questions, answers)
    
    // Add contextual insights based on analysis
    let contextualInsights = ''
    if (analysis.technicalComplexity === 'high') {
      contextualInsights += '\nNote: High technical complexity detected. Tasks should include detailed technical specifications.'
    }
    if (analysis.timelineSensitivity) {
      contextualInsights += '\nNote: Timeline sensitivity detected. Tasks should consider dependencies and critical path.'
    }
    if (analysis.resourceConstraints) {
      contextualInsights += '\nNote: Resource constraints detected. Tasks should be optimized for available resources.'
    }
    
    return `You are an expert project planner. Create a detailed task breakdown for: "${goal}"

Context: ${context || 'None provided'}
Notes: ${note || 'None provided'}
Task Type: ${taskType === 'dev' ? 'Development' : 'Custom'}

${userAnswersSummary}

${queryFocus}based on the user's detailed responses above.${contextualInsights}

Requirements:
- Generate 5-8 specific, actionable tasks
- Tasks should follow a logical sequence and dependencies
- Each task should be sized for 30-90 minutes of work
- Use imperative language (e.g., "Create", "Implement", "Test")
- Include relevant technical details when mentioned
- Consider the user's skill level and available resources

Return only the task list, one per line, without numbering or bullets.`
  }

  async function sendMessage() {
    if (!canSend) return
    
    // If we're in clarifying questions mode, handle the answer
    if (pendingClarify && clarifyQuestions.length > 0) {
      const currentAnswer = input.trim()
      if (currentAnswer.length === 0) return
      
      // Save the current answer
      const newAnswers = [...clarifyAnswers]
      newAnswers[clarifyStep] = currentAnswer
      setClarifyAnswers(newAnswers)
      
      // Add user's answer to chat
      const userMsg: ChatMessage = { id: uid(), role: 'user', content: currentAnswer }
      setMessages((m) => [...m, userMsg])
      setInput('')
      
      // Check if there are more questions
      if (clarifyStep < clarifyQuestions.length - 1) {
        // Move to next question
        const nextStep = clarifyStep + 1
        setClarifyStep(nextStep)
        
        // Show the next question
        setMessages((m) => [
          ...m,
          { id: uid(), role: 'assistant', content: clarifyQuestions[nextStep] }
        ])
        
        // Focus input for next answer
        setTimeout(() => {
          chatInputRef.current?.focus()
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
        }, 100)
        return
      } else {
        // All questions answered, generate tasks now
        setPendingClarify(false)
        const qa = clarifyQuestions
          .map((q, i) => [`Q${i + 1}: ${q}`, `A${i + 1}: ${newAnswers[i] || ''}`].join('\n'))
          .join('\n')
        setContext([originalContextRef.current, qa].filter(Boolean).join('\n'))
        
        // Generate tasks using the enhanced function that leverages all user answers
        setTasks([])
        setTasksProgress(0)
        setTasksTotal(0)
        setPendingCreateFromBreakdown(false)
        const token = Date.now()
        lastBreakdownToken.current = token
        setLoadingTasks(true)
        setTasksError(null)
        
        try {
          // Use the new enhanced task generation function
          const res = await generateTasksFromAnswers(goal, context, note, taskType, clarifyQuestions, newAnswers)
          if (lastBreakdownToken.current !== token) return
          
          // Validate tasks to ensure they're all valid strings
          const validTasks = res.filter(task => {
            const isValid = Boolean(task && typeof task === 'string' && task.trim().length > 0);
            if (!isValid) {
              console.error('Filtering out invalid task:', task);
            }
            return isValid;
          });
          
          console.log('Valid tasks generated from answers:', validTasks)

          // Log the task generation process for debugging and improvement
          logTaskGeneration(goal, context, note, taskType, clarifyQuestions, newAnswers, validTasks)

          // If generating subtasks for a specific card, attach and open carousel
          if (subtasksTargetCardId) {
            const targetId = subtasksTargetCardId
            const targetTitle = (taskCards.find((c) => c.id === targetId)?.title) || 'task'
            const subtaskObjs = validTasks.map((t) => ({ id: uid(), title: t, done: false, estimate: '', notes: '' }))
            setTaskCards((cards) =>
              cards.map((c) => (c.id === targetId ? { ...c, subtasks: [...c.subtasks, ...subtaskObjs] } : c)),
            )
            setCarouselTaskId(targetId)
            setCarouselIndex(0)
            setTasks([])
            setTasksProgress(0)
            setTasksTotal(0)
            setPendingCreateFromBreakdown(false)
            setShowRightBreakdown(false)
            setSubtasksTargetCardId(null)
            setMessages((m) => [
              ...m,
              { id: uid(), role: 'assistant', content: `Created ${subtaskObjs.length} subtasks for "${targetTitle}". Opening the subtask carousel.` },
            ])
          } else {
            // Default: show suggested tasks and Next-task flow
          setTasks(validTasks)
          setTasksProgress(0)
          setTasksTotal(validTasks.length)
          setPendingCreateFromBreakdown(false)
          setShowRightBreakdown(false)
            const analysis = analyzeUserAnswers(clarifyQuestions, newAnswers)
            let influenceMessage = `Excellent! I've analyzed all your answers and generated ${validTasks.length} tailored tasks. `
            if (analysis.technicalComplexity === 'high') {
              influenceMessage += 'Your technical requirements helped me create detailed implementation tasks. '
            }
            if (analysis.timelineSensitivity) {
              influenceMessage += 'I\'ve prioritized timeline and dependencies based on your urgency. '
            }
            if (analysis.resourceConstraints) {
              influenceMessage += 'Tasks are optimized for your available resources. '
            }
            influenceMessage += 'Click "Next task" to review them one by one.'
          setMessages((m) => [
            ...m,
              { id: uid(), role: 'assistant', content: influenceMessage },
          ])
          setTimeout(() => {
            chatInputRef.current?.focus()
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
          }, 0)
          }
        } catch (err: any) {
          setTasksError(err?.message ?? 'Failed to generate tasks')
        } finally {
          setLoadingTasks(false)
        }
        return
      }
    }
    
    // Regular chat message handling
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: input.trim() }
    setMessages((m) => [...m, userMsg])
    setInput('')
    
    // Build a contextual message that includes current goal, context, and notes
    let contextualMessage = userMsg.content
    if (goal || context || note) {
      const contextParts = []
      if (goal) contextParts.push(`Goal: ${goal}`)
      if (context) contextParts.push(`Context: ${context}`)
      if (note) contextParts.push(`Note: ${note}`)
      
      if (contextParts.length > 0) {
        contextualMessage = `${userMsg.content}\n\nCurrent context:\n${contextParts.join('\n')}`
      }
    }
    
    const history = [
      { role: 'system' as const, content: 'You are a concise, supportive coding coach. Use the provided context (goal, context, notes) to give more relevant and helpful responses.' },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: contextualMessage },
    ]
    const placeholderId = uid()
    setMessages((m) => [...m, { id: placeholderId, role: 'assistant', content: '…' }])
    try {
      const reply = await window.ai.chat(history as any)
      setMessages((m) => m.map((msg) => (msg.id === placeholderId ? { ...msg, content: reply } : msg)))
    } catch (err: any) {
      const msg = String(err?.message || err || '')
      setMessages((m) => m.map((msgI) => (msgI.id === placeholderId ? { ...msgI, content: `Error: ${msg}` } : msgI)))
    }
  }

  async function checkMood() {
    const res = await window.ai.mood(note)
    setMood(res)
    // Persist mood with timestamp
    try {
      await window.db.saveMood({ note, mood: res.mood, motivation: res.motivation, suggestion: res.suggestion })
    } catch {}
  }

  async function makeBreakdown(taskCardOrEvent: React.MouseEvent<HTMLElement> | TaskCard | undefined) {
    // Determine if the parameter is a TaskCard or a MouseEvent
    const isMouseEvent = taskCardOrEvent && 'nativeEvent' in taskCardOrEvent;
    const taskCard = !isMouseEvent ? taskCardOrEvent as TaskCard : undefined;
    // If a task card is provided, use its data
    if (taskCard) {
      console.log('Task card provided:', taskCard);
      setGoal((taskCard.title || 'Task') + ": " + (taskCard.description || ''))
      setContext(taskCard.notes || '')
    } else {
      console.log('No task card provided, using current goal and context');
    }
    // Derive effective goal/context from the provided taskCard to avoid async setState race
    const useGoal = (taskCard ? `${taskCard.title || 'Task'}: ${taskCard.description || ''}` : goal || '').trim()
    const useContext = taskCard ? (taskCard.notes || '') : (context || '')
    if (!useGoal) return
    // First: ask clarifying questions to improve specificity (always ask at least defaults)
    const clarifyKey = `${taskType}::${useGoal}::${useContext.trim()}::${(note || '').trim()}`
    if (lastClarifyKeyRef.current !== clarifyKey) {
      // New goal/context/note combination; reset any previous clarify state
      setClarifyQuestions([])
      setClarifyAnswers([])
      setClarifyStep(0)
      setPendingClarify(false)
      originalContextRef.current = useContext
      lastClarifyKeyRef.current = clarifyKey
    }
    let qs: string[] | null = null
    try {
      // Assume a Jr. Software developer is trying to work on the goal
      const userProfile = "Jr. Software Developer"
      const prevQA = clarifyQuestions.slice(0, clarifyStep).map((q, i) => ({ q, a: clarifyAnswers[i] }))
      const raw = await window.ai.clarifyRaw(useGoal, useContext, note, taskType, userProfile, prevQA)      
      const parsed = parseClarifyRaw(raw)
      if (parsed.length > 0) {
        qs = parsed
      } else {
        // fallback to structured clarify if raw parsing yields nothing
        qs = await window.ai.clarify(useGoal, useContext, note, taskType, 'Software Developer', prevQA)
      }
    } catch (err: any) {
      // Try a lightweight chat fallback using the latest user input and fields
      try {
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || ''
        // Build a more meaningful, contextual prompt
        const contextSummary = [
          useGoal && `The user wants to: ${useGoal}`,
          useContext && `They have this context: ${useContext}`,
          note && `Additional notes: ${note}`,
          `Task type: ${taskType}`
        ].filter(Boolean).join('. ')
        
        const prompt = [
          'Ask 2–4 concise clarifying questions based on this context:',
          contextSummary,
          '',
          'User input: ' + lastUserMsg,
          '',
          'Return plain text, one question per line. No numbering, no bullets, no extra prose.'
        ].join('\n')
        const raw = await window.ai.chat([
          { role: 'system', content: 'You ask only clarifying questions. Be specific and non-redundant.' },
          { role: 'user', content: prompt },
        ] as any)
        const parsed = parseClarifyRaw(raw)
        qs = parsed.length > 0 ? parsed : []
      } catch (fallbackErr) {
        const msg = String((fallbackErr as any)?.message || fallbackErr || '')
        const isQuota = /429|quota|rate limit/i.test(msg)
        setMessages((m) => [
          ...m,
          { id: uid(), role: 'assistant', content: isQuota
              ? 'I could not generate clarifying questions due to rate limits. Please share any additional details (goal, files/modules, constraints), or try again shortly.'
              : 'I hit an error generating clarifying questions. Please share any additional details (goal, files/modules, constraints), or try again.' },
        ])
        qs = []
      }
    }
    if (!qs || qs.length === 0) {
      // As a final attempt, try chat fallback even if earlier parse paths returned empty
      try {
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || ''
        // Build a more meaningful, contextual prompt
        const contextSummary = [
          useGoal && `The user wants to: ${useGoal}`,
          useContext && `They have this context: ${useContext}`,
          note && `Additional notes: ${note}`,
          `Task type: ${taskType}`
        ].filter(Boolean).join('. ')
        
        const prompt = [
          'Ask 2–4 concise clarifying questions based on this context:',
          contextSummary,
          '',
          'User input: ' + lastUserMsg,
          '',
          'Return plain text, one question per line. No numbering, no bullets, no extra prose.'
        ].join('\n')
        const raw = await window.ai.chat([
          { role: 'system', content: 'You ask only clarifying questions. Be specific and non-redundant.' },
          { role: 'user', content: prompt },
        ] as any)
        const parsed = parseClarifyRaw(raw)
        if (parsed.length > 0) {
          qs = parsed
        }
      } catch {}
      if (!qs || qs.length === 0) {
        setMessages((m) => [
          ...m,
          { id: uid(), role: 'assistant', content: 'I could not generate clarifying questions right now. Please provide more details so I can proceed.' },
        ])
        return
      }
    }
    setClarifyQuestions(qs)
    setClarifyAnswers(Array(qs.length).fill(''))
    setClarifyStep(0)
    setPendingClarify(true)
    originalContextRef.current = context
    setMessages((m) => [
      ...m,
      { id: uid(), role: 'assistant', content: `I'd like to ask you a few questions to better understand your needs. Let's go through them one by one.` },
      { id: uid(), role: 'assistant', content: qs[0] },
    ])
    return
    

  // generateTasksNow helper inlined where needed to avoid re-entrancy name issues
  }

  // Overlay helpers removed; actions happen within visible cards

  function showNextTask() {
    if (tasksProgress >= tasks.length) return
    const idx = tasksProgress
    const total = tasks.length
    const text = tasks[idx]
    setMessages((m) => [
      ...m,
      { id: uid(), role: 'assistant', content: `Task ${idx + 1}/${total}: ${text}` },
    ])
    const next = idx + 1
    setTasksProgress(next)
    if (next >= total) {
      setMessages((m) => [
        ...m,
        { id: uid(), role: 'assistant', content: 'That’s all. Review above and add any you want as child tasks.' },
      ])
    }
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }, 0)
  }

  function addOrSkipCurrent(add: boolean) {
    if (tasksTotal === 0) return
    const currentIndex = Math.max(0, tasksProgress - 1)
    const currentText = tasks[currentIndex]
    if (add && focusedTaskId && currentText) {
      const title = deriveThreeWordTitle(currentText)
      const child: TaskCard = {
        id: uid(),
        title,
        description: currentText,
        estimate: '',
        deadline: '',
        done: false,
        notes: '',
        hidden: false,
        status: 'new',
        parentId: focusedTaskId,
        subtasks: [],
      }
      setTaskCards((prev) => [...prev, child])
      setMessages((m) => [...m, { id: uid(), role: 'assistant', content: `Added: ${title}` }])
    }
    if (tasksProgress < tasksTotal) {
      showNextTask()
    } else {
      // done reviewing; clear task walkthrough state
      setTasks([])
      setTasksProgress(0)
      setTasksTotal(0)
      setPendingCreateFromBreakdown(false)
    }
  }

  // function copyTasks() {
  //   const text = tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
  //   navigator.clipboard.writeText(text)
  // }

  function handleCreateTasks(confirm: boolean) {
    if (confirm) {
      console.log('Creating tasks from:', tasks);
      setCreatedTasks(tasks)
      const name = simplifyGoal(goal)
      setCreatedListName(name)
      // Build child task cards under focused parent if present; otherwise top-level
      const parentId = focusedTaskId
      const cards: TaskCard[] = tasks.map((t) => {
        if (!t || typeof t !== 'string') {
          console.error('Invalid task:', t);
          return null; // We'll filter these out below
        }
        const title = deriveThreeWordTitle(t);
        console.log('Creating task card with title:', title, 'from task:', t);
        return {
          id: uid(),
          title: title,
          description: t,
          estimate: '',
          deadline: '',
          done: false,
          notes: '',
          hidden: false,
          status: 'new',
          parentId: parentId || undefined,
          subtasks: [],
        };
      }).filter(Boolean) as TaskCard[]; // Filter out null values
      setTaskCards((prev) => [...prev, ...cards])
      setMessages((m) => [
        ...m,
        { id: uid(), role: 'assistant', content: `Created ${cards.length} task cards under "${name}".` },
      ])
    } else {
      setMessages((m) => [...m, { id: uid(), role: 'assistant', content: 'Okay — not creating tasks.' }])
    }
    setPendingCreateFromBreakdown(false)
  }

  function simplifyGoal(text: string): string {
    const cleaned = (text || 'My goal').replace(/\s+/g, ' ').trim()
    if (cleaned.length <= 60) return cleaned
    const words = cleaned.split(' ').slice(0, 10)
    const short = words.join(' ')
    return short + '…'
  }

  function deriveThreeWordTitle(text: string): string {
    console.log('deriveThreeWordTitle input:', text);
    if (!text || typeof text !== 'string') {
      console.error('Invalid input to deriveThreeWordTitle:', text);
      return 'New Task';
    }
    const cleaned = text
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) return 'New Task'
    const words = cleaned.split(' ').slice(0, 3)
    const titled = words
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
      .join(' ')
    console.log('deriveThreeWordTitle output:', titled || 'New Task');
    return titled || 'New Task'
  }

  function startEditListName() {
    setPendingListName(createdListName || '')
    setIsEditingListName(true)
  }

  function saveListName() {
    const next = pendingListName.trim() || 'Untitled goal'
    setCreatedListName(next)
    setIsEditingListName(false)
  }

  function startEditTitle(id: string, current: string) {
    setEditingTitleId(id)
    setTitleDraft(current)
  }

  function saveEditTitle() {
    const next = titleDraft.trim()
    if (editingTitleId) {
      if (next) {
        setTaskCards((cards) => cards.map((c) => (c.id === editingTitleId ? { ...c, title: next } : c)))
      }
    }
    setEditingTitleId(null)
    setTitleDraft('')
  }

  function cancelEditTitle() {
    setEditingTitleId(null)
    setTitleDraft('')
  }

  // function openSubtaskCarousel(taskId: string) {
  //   setCarouselTaskId(taskId)
  //   setCarouselIndex(0)
  // }

  function closeSubtaskCarousel() {
    setCarouselTaskId(null)
    setCarouselIndex(0)
  }

  function stepCarousel(delta: number) {
    if (!carouselTaskId) return
    const task = taskCards.find((t) => t.id === carouselTaskId)
    if (!task) return
    const total = task.subtasks.length
    if (total === 0) return
    setCarouselIndex((i) => {
      const next = (i + delta + total) % total
      return next
    })
  }

  function cancelEditListName() {
    setIsEditingListName(false)
  }

  // Legacy fan layout removed

  function sortByDeadline(cards: TaskCard[]): TaskCard[] {
    const parse = (d: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(d) : Number.POSITIVE_INFINITY)
    return [...cards].sort((a, b) => parse(a.deadline) - parse(b.deadline))
  }

  return (
    <>
    {/* Top nav */}
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, borderBottom: '1px solid #eee', background: '#fafafa', display: 'flex', gap: 8 }}>
        <Button type={activeView === 'dashboard' ? 'primary' : 'default'} onClick={() => setActiveView('dashboard')}>Dashboard</Button>
        <Button type={activeView === 'assistant' ? 'primary' : 'default'} onClick={() => setActiveView('assistant')}>Assistant</Button>
      </div>
      {activeView === 'assistant' ? (
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '40% 60%', gap: 0, padding: 0 }}>
      <Layout style={{ gridColumn: '1', height: '100%', background: '#fff' }}>
        <Layout.Header style={{ background: '#fafafa', paddingInline: 16, borderBottom: '1px solid #eee' }}>
          <Typography.Text strong>Assistant Chat</Typography.Text>
        </Layout.Header>
        <Layout.Content style={{ padding: 16, overflow: 'auto' }} ref={scrollRef as any}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {messages.map((m) => (
              <div key={m.id}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{m.role}</Typography.Text>
                <div>{m.content}</div>
              </div>
            ))}
          </Space>
        </Layout.Content>
        <Divider style={{ margin: 0 }} />
        <div style={{ display: 'flex', gap: 8, padding: 12, alignItems: 'center' }}>
          <Input
            size="middle"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={pendingClarify && clarifyQuestions.length > 0 
              ? `Answer question ${clarifyStep + 1} of ${clarifyQuestions.length}...` 
              : "Ask for help, next steps, or guidance..."}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            ref={chatInputRef as any}
          />
          {tasksTotal > 0 && tasksProgress < tasksTotal && !pendingCreateFromBreakdown && !loadingTasks && !showRightBreakdown && (
            <Space>
              <Button onClick={() => addOrSkipCurrent(true)}>Add task ({tasksProgress}/{tasksTotal})</Button>
              <Button onClick={() => addOrSkipCurrent(false)}>Skip</Button>
              <Button onClick={showNextTask}>Next ({tasksProgress + 1}/{tasksTotal})</Button>
            </Space>
          )}
          <Button type="primary" icon={<SendOutlined />} onClick={sendMessage} disabled={!canSend} />
          {pendingCreateFromBreakdown && (
            <Space>
              <Button type="primary" size="small" onClick={() => handleCreateTasks(true)}>Create tasks</Button>
              <Button size="small" onClick={() => handleCreateTasks(false)}>No thanks</Button>
            </Space>
          )}
        </div>
      </Layout>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, gridColumn: '2', height: '100%', minHeight: 0, overflow: 'auto', padding: 16, paddingBottom: 96 }}>

        {!focusedTaskId && showMoodPanel && (
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ flex: 1 }}>Mood Check-in</span>
              <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setShowMoodPanel(false)} />
            </div>
          }
          bordered
        >
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Input.TextArea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="How are you feeling about your work today?" />
            <Button type="primary" onClick={checkMood}>Assess</Button>
            {mood && (
              <div style={{ fontSize: 14 }}>
                <div>Mood: {mood.mood}</div>
                <div>Motivation: {mood.motivation}/10</div>
                <div>Tip: {mood.suggestion}</div>
              </div>
            )}
          </Space>
        </Card>
        )}

        {!focusedTaskId && showBreakdownPanel && (
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ flex: 1 }}>Task Breakdown</span>
              <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setShowBreakdownPanel(false)} />
            </div>
          }
          bordered
        >
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Space align="center" size={12} wrap>
              <Typography.Text type="secondary">Task type</Typography.Text>
              <Select
                size="middle"
                value={taskType}
                style={{ width: 180 }}
                onChange={(v) => setTaskType(v as any)}
                options={[
                  { label: 'Custom', value: 'custom' },
                  { label: 'Development', value: 'dev' },
                ]}
              />
            </Space>
            <Input value={goal || ""} onChange={(e) => setGoal(e.target.value)} placeholder="High-level goal" />
            <Input.TextArea rows={3} value={context || ""} onChange={(e) => setContext(e.target.value)} placeholder="Any context (repo, blockers, constraints)" />
            <Button type="primary" onClick={makeBreakdown} loading={loadingTasks}>Generate Tasks</Button>
            {tasksError && <Typography.Text type="danger">{tasksError}</Typography.Text>}
          </Space>
        </Card>
        )}

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Card title="My Tasks" bordered bodyStyle={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {createdTasks.length > 0 && !isEditingListName && (
            <>
              <Typography.Text type="secondary">·</Typography.Text>
              <Typography.Text title={createdListName} style={{ maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {createdListName || 'Untitled goal'}
              </Typography.Text>
              <div style={{ marginLeft: 'auto' }}>
                <Button size="small" onClick={startEditListName}>Edit name</Button>
              </div>
            </>
          )}
          {isEditingListName && (
            <Space.Compact style={{ width: '100%' }}>
              <Input value={pendingListName} onChange={(e) => setPendingListName(e.target.value)} placeholder="List name" onKeyDown={(e) => {
                if (e.key === 'Enter') saveListName()
                if (e.key === 'Escape') cancelEditListName()
              }} />
              <Button onClick={saveListName}>Save</Button>
              <Button onClick={cancelEditListName}>Cancel</Button>
            </Space.Compact>
          )}
          <div style={{ paddingTop: 12, flex: 1, minHeight: 0, overflow: 'auto' }}>
            {pendingClarify && clarifyQuestions.length > 0 && (
              <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 14, color: '#666' }}>
                    Question {clarifyStep + 1} of {clarifyQuestions.length}
                  </div>
                  <div style={{ flex: 1, height: 4, background: '#f0f0f0', borderRadius: 2 }}>
                    <div 
                      style={{ 
                        height: '100%', 
                        background: '#1890ff', 
                        borderRadius: 2, 
                        width: `${((clarifyStep + 1) / clarifyQuestions.length) * 100}%`,
                        transition: 'width 0.3s ease'
                      }} 
                    />
                  </div>
                </div>
                <div style={{ 
                  padding: 12, 
                  background: '#f8f9fa', 
                  borderRadius: 8, 
                  border: '1px solid #e9ecef',
                  fontSize: 16,
                  fontWeight: 500
                }}>
                  {clarifyQuestions[clarifyStep]}
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  <Button 
                    size="small" 
                    onClick={() => {
                      if (clarifyStep > 0) {
                        const prev = clarifyStep - 1
                        setClarifyStep(prev)
                        setMessages((m) => [...m, { id: uid(), role: 'assistant', content: clarifyQuestions[prev] }])
                      }
                    }} 
                    disabled={clarifyStep === 0}
                  >
                    Previous
                  </Button>
                  <Button 
                    size="small" 
                    onClick={() => {
                      // Skip remaining questions and generate now
                      setPendingClarify(false)
                      const qa = clarifyQuestions
                        .map((q, i) => [`Q${i + 1}: ${q}`, `A${i + 1}: ${clarifyAnswers[i] || ''}`].join('\n'))
                        .join('\n')
                      setContext([originalContextRef.current, qa].filter(Boolean).join('\n'))
                      ;(async () => {
                        setTasks([])
                        setTasksProgress(0)
                        setTasksTotal(0)
                        setPendingCreateFromBreakdown(false)
                        const token = Date.now()
                        lastBreakdownToken.current = token
                        setLoadingTasks(true)
                        setTasksError(null)
                        try {
                          const res = await window.ai.breakdown(goal, context, taskType)
                          if (lastBreakdownToken.current !== token) return
                          
                          // Validate tasks to ensure they're all valid strings
                          const validTasks = res.filter(task => {
                            const isValid = Boolean(task && typeof task === 'string' && task.trim().length > 0);
                            if (!isValid) {
                              console.error('Filtering out invalid task:', task);
                            }
                            return isValid;
                          });
                          
                          console.log('Valid tasks:', validTasks);
                          // If user clicked AI Generate Subtasks on a card, attach to that card and open carousel
                          if (subtasksTargetCardId) {
                            const targetId = subtasksTargetCardId
                            const targetTitle = (taskCards.find((c) => c.id === targetId)?.title) || 'task'
                            const subtaskObjs = validTasks.map((t) => ({ id: uid(), title: t, done: false, estimate: '', notes: '' }))
                            setTaskCards((cards) =>
                              cards.map((c) => (c.id === targetId ? { ...c, subtasks: [...c.subtasks, ...subtaskObjs] } : c)),
                            )
                            setCarouselTaskId(targetId)
                            setCarouselIndex(0)
                            setTasks([])
                            setTasksProgress(0)
                            setTasksTotal(0)
                            setPendingCreateFromBreakdown(false)
                            setShowRightBreakdown(false)
                            setSubtasksTargetCardId(null)
                            setMessages((m) => [
                              ...m,
                              { id: uid(), role: 'assistant', content: `Created ${subtaskObjs.length} subtasks for "${targetTitle}". Opening the subtask carousel.` },
                            ])
                          } else {
                          setTasks(validTasks)
                          setTasksProgress(0)
                          setTasksTotal(validTasks.length)
                          setPendingCreateFromBreakdown(false)
                          setShowRightBreakdown(false)
                          setMessages((m) => [
                            ...m,
                            { id: uid(), role: 'assistant', content: `I have ${validTasks.length} suggested tasks. Click "Next task" to review them one by one.` },
                          ])
                          }
                          setTimeout(() => {
                            chatInputRef.current?.focus()
                            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
                          }, 0)
                        } catch (err: any) {
                          setTasksError(err?.message ?? 'Failed to generate tasks')
                        } finally {
                          setLoadingTasks(false)
                        }
                      })()
                    }}
                  >
                    Skip questions
                  </Button>
                </div>
              </div>
            )}
            {focusedTaskId && (
              <div style={{ border: '1px dashed #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                {(() => {
                  const ft = taskCards.find((t) => t.id === focusedTaskId)
                  if (!ft) return <Typography.Text type="secondary">(not found)</Typography.Text>
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                      <div style={{ fontWeight: 800, fontSize: 16 }}>{ft.title}</div>
                      <div>
                        <Typography.Text type="secondary">Estimated time</Typography.Text>
                        <Input value={ft.estimate} onChange={(e) => updateEstimate(ft.id, e.target.value)} placeholder="e.g. 30 min" />
                      </div>
                      <Input.TextArea
                        rows={3}
                        placeholder="Notes for this task..."
                        value={ft.notes}
                        onChange={(e) => updateNotes(ft.id, e.target.value)}
                      />
                      <div>
                        <Button
                          type="primary"
                          disabled={
                            pendingClarify ||
                            loadingTasks ||
                            tasks.length > 0 ||
                            (tasksTotal > 0 && tasksProgress < tasksTotal) ||
                            pendingCreateFromBreakdown
                          }
                          onClick={async () => {
                            const ftNow = taskCards.find((t) => t.id === focusedTaskId)
                            if (!ftNow) return
                            setTaskType('dev')
                            // Prime chat with context
                            setMessages(m => [
                              ...m,
                              { id: uid(), role: 'user', content: `Generate tasks for: ${ftNow.title}` },
                              { id: uid(), role: 'assistant', content: 'I will ask a few clarifying questions based on the title and notes to plan tasks.' },
                            ])
                            await makeBreakdown(ftNow)
                          }}
                        >Generate Tasks</Button>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
            {!focusedTaskId && showRightBreakdown && tasks.length > 0 ? (
      <div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Suggested tasks</div>
                <ol style={{ paddingLeft: 18 }}>
                  {tasks.map((t, i) => (
                    <li key={`${i}-${t}`}>{t}</li>
                  ))}
                </ol>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={() => setPendingCreateFromBreakdown(true)}>Create tasks</button>
                  <button onClick={() => setShowRightBreakdown(false)}>Close</button>
                </div>
              </div>
            ) : (!focusedTaskId && carouselTaskId && carouselTask && carouselTotal > 0 && carouselCurrent) ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                <div
                  style={{
                    border: '1px solid #ccc',
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: '#fff',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{ background: '#f6f8ff', padding: '8px 12px' }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: '#000' }}>
                      {carouselTask.title} — subtasks
                    </div>
                    <div style={{ height: 1, background: '#e6e9ff', marginTop: 6 }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
                    <Button type="primary" onClick={() => stepCarousel(-1)}>{'<'}</Button>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          border: '1px solid #ccc',
                          borderRadius: 8,
                          overflow: 'hidden',
                          background: carouselCurrent.done ? '#f3fff3' : 'white',
                          display: 'flex',
                          flexDirection: 'column',
                        }}
                      >
                        <div style={{ background: '#f6f8ff', padding: '8px 12px' }}>
                          <div style={{ fontWeight: 800, fontSize: 15, color: '#000', textDecoration: carouselCurrent.done ? 'line-through' : 'none' }}>
                            {carouselCurrent.title}
                          </div>
                          <div style={{ height: 1, background: '#e6e9ff', marginTop: 6 }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Subtask for: {carouselTask.title}</Typography.Text>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                            <Typography.Text type="secondary">Estimated time</Typography.Text>
                            <Input
                              value={carouselCurrent.estimate}
                              onChange={(e) =>
                                setTaskCards((cards) =>
                                  cards.map((c) =>
                                    c.id === (carouselTaskId as string)
                                      ? {
                                          ...c,
                                          subtasks: c.subtasks.map((s, idx) =>
                                            idx === carouselIndex ? { ...s, estimate: e.target.value } : s,
                                          ),
                                        }
                                      : c,
                                  ),
                                )
                              }
                              placeholder="e.g. 15 min"
                              style={{ width: 160 }}
                            />
                          </div>
                          <Input.TextArea
                            value={carouselCurrent.notes}
                            onChange={(e) =>
                              setTaskCards((cards) =>
                                cards.map((c) =>
                                  c.id === (carouselTaskId as string)
                                    ? {
                                        ...c,
                                        subtasks: c.subtasks.map((s, idx) =>
                                          idx === carouselIndex ? { ...s, notes: e.target.value } : s,
                                        ),
                                      }
                                    : c,
                                ),
                              )
                            }
                            placeholder="Notes…"
                            rows={3}
                          />
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button onClick={() =>
                              setTaskCards((cards) =>
                                cards.map((c) =>
                                  c.id === (carouselTaskId as string)
                                    ? {
                                        ...c,
                                        subtasks: c.subtasks.map((s, idx) =>
                                          idx === carouselIndex ? { ...s, done: !s.done } : s,
                                        ),
                                      }
                                    : c,
                                ),
                              )
                            }>
                              {carouselCurrent.done ? 'Undo' : 'Mark done'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <Button type="primary" onClick={() => stepCarousel(1)}>{'>'}</Button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 12px 12px' }}>
                    <Button type="primary" onClick={closeSubtaskCarousel}>← Back to tasks</Button>
                  </div>
                </div>
              </div>
            ) : (!focusedTaskId && taskCards.length === 0) ? (
              <Typography.Text type="secondary">No tasks yet. Generate a breakdown to create tasks.</Typography.Text>
            ) : (!focusedTaskId) ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                {taskCards.filter(card => !card.hidden).map((card) => (
                  <Card
                    key={card.id}
                    style={{ overflow: 'hidden', background: card.done ? '#f3fff3' : undefined }}
                  >
                    <div style={{ background: card.done ? '#e9fff0' : '#f6f8ff', padding: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        {editingTitleId === card.id ? (
                          <Input
                            autoFocus
                            value={titleDraft}
                            onChange={(e) => setTitleDraft(e.target.value)}
                            onBlur={saveEditTitle}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEditTitle()
                              if (e.key === 'Escape') cancelEditTitle()
                            }}
                            size="middle"
                            style={{ flex: 1 }}
                          />
                        ) : (
                          <div
                            title={card.description}
                            onClick={() => startEditTitle(card.id, card.title)}
                            style={{ fontWeight: 800, fontSize: 15, color: '#000', cursor: 'text', flex: 1 }}
                          >
                            {card.title}
                          </div>
                        )}
                        <Button 
                          type="text" 
                          icon={<CloseOutlined />} 
                          size="small" 
                          onClick={() => hideCard(card.id)}
                          style={{ marginLeft: 8 }}
                        />
                      </div>
                      <Divider style={{ marginTop: 6, marginBottom: 0 }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12 }}>
                      <Typography.Text type="secondary">{card.description}</Typography.Text>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography.Text type="secondary">Estimated time</Typography.Text>
                        <Input
                          value={card.estimate}
                          onChange={(e) => updateEstimate(card.id, e.target.value)}
                          placeholder="e.g. 30 min"
                        />
                      </div>
                      <Input.TextArea rows={3}
                        value={card.notes}
                        onChange={(e) => updateNotes(card.id, e.target.value)}
                        placeholder="Notes…"
                      />
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        {card.subtasks.length === 0 && !Object.prototype.hasOwnProperty.call(subtaskDrafts, card.id) && (
                          <>
                            <Button onClick={() => { beginAddSubtask(card.id) }}>Create sub tasks</Button>
                            <Button 
                              type="primary" 
                              onClick={async () => {
                                // Add messages to chat
                                console.log('AI Generate Subtasks clicked for card:', card);
                                // Mark which card should receive generated subtasks
                                setSubtasksTargetCardId(card.id)
                                setMessages(m => [
                                  ...m,
                                  { id: uid(), role: 'user', content: `Generate tasks from this task card: ${card.title}` },
                                  { id: uid(), role: 'assistant', content: `I'll help break down the task "${card.title}" into smaller steps for a Jr. Software Developer.` },
                                ])
                                await makeBreakdown(card)
                                // Scroll to chat
                                setTimeout(() => {
                                  scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
                                }, 100)
                              }}
                            >
                              AI Generate Subtasks
                            </Button>
                          </>
                        )}
                      </div>
                      {/* Show compact subtasks list inline (checkbox + title only) */}
                      {card.subtasks.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {card.subtasks.map((s) => (
                            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-start' }}>
                              <Checkbox checked={s.done} onChange={() => toggleSubtask(card.id, s.id)} />
                              <span style={{ color: '#000', textAlign: 'left', textDecoration: s.done ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
                                {s.title}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {Object.prototype.hasOwnProperty.call(subtaskDrafts, card.id) && (
                        <div style={{ marginTop: 8 }}>
                          <Space.Compact style={{ width: '100%' }}>
                            <Input
                              value={subtaskDrafts[card.id] || ''}
                              onChange={(e) => setSubtaskDrafts((d) => ({ ...d, [card.id]: e.target.value }))}
                              placeholder="New subtask…"
                              onPressEnter={() => addSubtask(card.id)}
                            />
                            <Button type="primary" onClick={() => addSubtask(card.id)}>Add</Button>
                          </Space.Compact>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Button onClick={() => toggleDone(card.id)}>{card.done ? 'Undo' : 'Mark done'}</Button>
                      </div>
                      {card.subtasks.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <Button
                            onClick={() => { setCarouselTaskId(card.id); setCarouselIndex(0) }}
                            style={{ color: 'navy', fontWeight: 700, fontStyle: 'italic', textDecoration: 'none', padding: 0 }}
                          >
                            see sub tasks {'>>'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              // Focused view: show children under parent
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                {taskCards.filter(c => c.parentId === focusedTaskId).map((child) => (
                  <Card key={child.id} style={{ width: '94%', marginLeft: '3%', borderColor: '#ead6b7' }}>
                    <div style={{ fontWeight: 700 }}>{child.title}</div>
                    <Input.TextArea rows={2} placeholder="Notes…" value={child.notes} onChange={(e) => updateNotes(child.id, e.target.value)} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                      <Button size="small" onClick={() => beginAddSubtask(child.id)}>Add Subtask</Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </Card>
        </div>
      </div>
      </div>
      ) : (
        // Dashboard view: tasks only
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff' }}>
          <div style={{ padding: 16 }}>
            {/* Development task creation card (shown via + button) */}
            {showDevCreateCard && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 340px)', gridAutoRows: 360, gap: 16, justifyContent: 'center' }}>
                <Card key="new-dev-task" style={{ width: 340, height: 360, display: 'flex', flexDirection: 'column', justifySelf: 'center' }}>
                  <div style={{ padding: 12, background: '#f6f8ff' }}>
                    <Typography.Text strong>Create development task</Typography.Text>
                  </div>
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, flex: 1, overflow: 'auto' }}>
                    <div>
                      <Typography.Text type="secondary">Title</Typography.Text>
                      <Input placeholder="Task title" value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <Typography.Text type="secondary">Deadline</Typography.Text>
                        <DatePicker
                          style={{ width: '100%' }}
                          value={newTaskDeadline ? (window as any).dayjs?.(newTaskDeadline) : undefined}
                          onChange={(v: any) => setNewTaskDeadline(v ? v.format('YYYY-MM-DD') : '')}
                          allowClear
                          showToday
                        />
                      </div>
                      <div>
                        <Typography.Text type="secondary">Estimated time</Typography.Text>
                        <Input placeholder="e.g. 30 min" value={newTaskEstimate} onChange={(e) => setNewTaskEstimate(e.target.value)} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <Button
                        onClick={() => {
                          const title = newTaskTitle.trim()
                          if (!title) return
                          const card: TaskCard = {
                            id: uid(),
                            title,
                            description: '',
                            estimate: newTaskEstimate.trim(),
                            deadline: newTaskDeadline.trim(),
                            done: false,
                            notes: '',
                            hidden: false,
                            status: 'new',
                            subtasks: [],
                          }
                          setTaskCards((prev) => sortByDeadline([card, ...prev]))
                          setDevCreateCanStart(true)
                          setDevCreateLastTaskId(card.id)
                          setShowDevCreateCard(false)
                        }}
                      >Save</Button>
                      <Button type="primary" disabled={!devCreateCanStart} onClick={() => {
                        // Construct a temporary TaskCard object and start breakdown without adding to dashboard yet
                        const tempCard = devCreateLastTaskId ? taskCards.find((t) => t.id === devCreateLastTaskId) : null
                        if (!tempCard) return
                        setDevCreateCanStart(false)
                        setShowDevCreateCard(false)
                        // Navigate to assistant and begin breakdown
                        setActiveView('assistant')
                        makeBreakdown(tempCard as any)
                        // Clear form inputs
                        setNewTaskTitle('')
                        setNewTaskEstimate('')
                        setNewTaskDeadline('')
                      }}>Start task</Button>
                    </div>
                  </div>
                </Card>
              </div>
            )}
            {/* We still render the task cards list below for visibility */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 340px)', gridAutoRows: 360, gap: 16, justifyContent: 'center', alignItems: 'start' }}>
              {sortByDeadline(taskCards.filter(card => !card.hidden)).map((card) => (
                <Card key={card.id} style={{ width: 340, height: 360, overflow: 'hidden', background: card.done ? '#f3fff3' : undefined, display: 'flex', flexDirection: 'column', justifySelf: 'center' }}>
                  <div style={{ background: '#d2b48c', padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {editingTitleId === card.id ? (
                        <Input
                          autoFocus
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          onBlur={saveEditTitle}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditTitle()
                            if (e.key === 'Escape') cancelEditTitle()
                          }}
                          size="middle"
                          style={{ flex: 1 }}
                        />
                      ) : (
                        <div
                          title={card.description}
                          style={{ fontWeight: 800, fontSize: 15, color: '#000', flex: 1 }}
                        >
                          {card.title}
                        </div>
                      )}
                    </div>
                    <Divider style={{ marginTop: 6, marginBottom: 0 }} />
                  </div>
                  {/* Edit icon moved into body top-right */}
                  <div style={{ padding: 12, paddingBottom: 0, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Button
                      type="text"
                      icon={<EditOutlined />}
                      size="small"
                      onClick={() => {
                        setEditingDetailsId(card.id)
                        setEditingTitleId(card.id)
                        setTitleDraft(card.title)
                        setDetailsEstimateDraft(card.estimate)
                        setDetailsDeadlineDraft(card.deadline)
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, paddingTop: 8, flex: 1, overflow: 'auto' }}>
                    <div style={{ fontSize: 11, color: '#8b5a2b', fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>Details</div>
                    <div style={{ border: '1px solid #ead6b7', background: '#fffaf0', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {editingDetailsId === card.id ? (
                        <>
                          <div>
                            <Typography.Text type="secondary">Estimated time</Typography.Text>
                            <Input value={detailsEstimateDraft} onChange={(e) => setDetailsEstimateDraft(e.target.value)} placeholder="e.g. 30 min" />
                          </div>
                          <div>
                            <Typography.Text type="secondary">Deadline</Typography.Text>
                            <Input value={detailsDeadlineDraft} onChange={(e) => setDetailsDeadlineDraft(e.target.value)} placeholder="e.g. Fri 5pm" />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                            <Button onClick={() => { setEditingDetailsId(null); setEditingTitleId(null); }}>Cancel</Button>
                            <Button type="primary" onClick={() => {
                              updateEstimate(card.id, detailsEstimateDraft)
                              updateDeadline(card.id, detailsDeadlineDraft)
                              if (editingTitleId === card.id) {
                                saveEditTitle()
                              }
                              setEditingDetailsId(null)
                            }}>Save</Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <Typography.Text type="secondary">Estimated time: </Typography.Text>
                            <span>{card.estimate || '-'}</span>
                          </div>
                          <div>
                            <Typography.Text type="secondary">Deadline: </Typography.Text>
                            <span>{card.deadline || '-'}</span>
                          </div>
                          {card.status === 'started' && (
                            <div>
                              <Typography.Text type="secondary">Status: </Typography.Text>
                              <span>Started</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {/* Start task below details */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 12px 12px' }}>
                    {devCreateCanStart && devCreateLastTaskId === card.id && (
                      <Button className="startTaskBtn" onClick={async () => {
                        const tempCard = taskCards.find((t) => t.id === card.id)
                        if (!tempCard) return
                        // mark status started on this card
                        setTaskCards((prev) => prev.map((c) => c.id === card.id ? { ...c, status: 'started' } : c))
                        setDevCreateCanStart(false)
                        setDevCreateLastTaskId(null)
                        setFocusedTaskId(card.id)
                        setActiveView('assistant')
                        // Focus chat and scroll; user will click Generate Tasks in focused panel
                        setTimeout(() => {
                          chatInputRef.current?.focus()
                          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
                        }, 0)
                      }}>Start task</Button>
            )}
          </div>
        </Card>
              ))}
        </div>
      </div>
      </div>
      )}
      <FloatButton.Group shape="circle" style={{ right: 24, bottom: 24 }} trigger="click" icon={<PlusOutlined />}>
        <FloatButton
          tooltip="Mood check in"
          icon={<SmileOutlined />}
          onClick={() => {
            setShowMoodPanel(true)
          }}
        />
        <FloatButton
          tooltip="Development task"
          icon={<CodeOutlined />}
          onClick={() => {
            if (activeView === 'dashboard') {
              setShowDevCreateCard(true)
            } else {
            setTaskType('dev')
            setShowBreakdownPanel(true)
            }
          }}
        />
        <FloatButton
          tooltip="Custom task breakdown"
          icon={<ProfileOutlined />}
          onClick={() => {
            setTaskType('custom')
            setShowBreakdownPanel(true)
          }}
        />
      </FloatButton.Group>

      {/* Overlay panels removed in favor of showing cards on demand */}
    </div>
    </>
  )
}

export default App

// Helpers to manage task card state
function useTaskCardHelpers(
  setTaskCards: Dispatch<SetStateAction<TaskCard[]>>,
  subtaskDrafts: Record<string, string>,
  setSubtaskDrafts: Dispatch<SetStateAction<Record<string, string>>>,
) {
  function toggleDone(id: string) {
    setTaskCards((cards) => cards.map((c) => (c.id === id ? { ...c, done: !c.done } : c)))
  }
  function updateEstimate(id: string, estimate: string) {
    setTaskCards((cards) => cards.map((c) => (c.id === id ? { ...c, estimate } : c)))
  }
  function updateDeadline(id: string, deadline: string) {
    setTaskCards((cards) => cards.map((c) => (c.id === id ? { ...c, deadline } : c)))
  }
  function updateNotes(id: string, notes: string) {
    setTaskCards((cards) => cards.map((c) => (c.id === id ? { ...c, notes } : c)))
  }
  function hideCard(id: string) {
    setTaskCards((cards) => cards.map((c) => (c.id === id ? { ...c, hidden: true } : c)))
  }
  function beginAddSubtask(id: string) {
    setSubtaskDrafts((d) => ({ ...d, [id]: d[id] ?? '' }))
  }
  function addSubtask(id: string) {
    const title = (subtaskDrafts[id] || '').trim()
    if (!title) return
    setTaskCards((cards) =>
      cards.map((c) =>
        c.id === id
          ? { ...c, subtasks: [...c.subtasks, { id: uid(), title, done: false, estimate: '', notes: '' }] }
          : c,
      ),
    )
    setSubtaskDrafts((d) => ({ ...d, [id]: '' }))
  }
  function toggleSubtask(id: string, subId: string) {
    setTaskCards((cards) =>
      cards.map((c) =>
        c.id === id
          ? { ...c, subtasks: c.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)) }
          : c,
      ),
    )
  }
  function renderSubtasks(card: TaskCard) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {card.subtasks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {card.subtasks.map((s) => (
              <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid #eee', borderRadius: 6, padding: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox checked={s.done} onChange={() => toggleSubtask(card.id, s.id)} />
                  <span style={{ color: '#000', textDecoration: s.done ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
                    {s.title}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Typography.Text type="secondary">Estimated time</Typography.Text>
                  <Input value={s.estimate}
                         onChange={(e) => setTaskCards((cards) => cards.map((c) => c.id === card.id ? { ...c, subtasks: c.subtasks.map((st) => st.id === s.id ? { ...st, estimate: e.target.value } : st) } : c))}
                         placeholder="e.g. 15 min" style={{ width: 160 }} />
                </div>
                <Input.TextArea rows={2}
                  value={s.notes}
                  onChange={(e) => setTaskCards((cards) => cards.map((c) => c.id === card.id ? { ...c, subtasks: c.subtasks.map((st) => st.id === s.id ? { ...st, notes: e.target.value } : st) } : c))}
                  placeholder="Notes…" />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button onClick={() => toggleSubtask(card.id, s.id)}>{s.done ? 'Undo' : 'Mark done'}</Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {Object.prototype.hasOwnProperty.call(subtaskDrafts, card.id) && (
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={subtaskDrafts[card.id] || ''}
              onChange={(e) => setSubtaskDrafts((d) => ({ ...d, [card.id]: e.target.value }))}
              placeholder="New subtask…"
              onPressEnter={() => addSubtask(card.id)}
            />
            <Button type="primary" onClick={() => addSubtask(card.id)}>Add</Button>
          </Space.Compact>
        )}
      </div>
    )
  }
  return { toggleDone, updateEstimate, updateDeadline, updateNotes, hideCard, beginAddSubtask, addSubtask, renderSubtasks, toggleSubtask }
}
