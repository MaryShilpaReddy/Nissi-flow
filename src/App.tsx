import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import './App.css'
import { Layout, Typography, Input, Button, Divider, Card, Space, Checkbox, Select, FloatButton } from 'antd'
import { SendOutlined, PlusOutlined, SmileOutlined, CodeOutlined, ProfileOutlined, CloseOutlined } from '@ant-design/icons'

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string }
const uid = () => Math.random().toString(36).slice(2, 10)

type TaskCard = {
  id: string
  title: string
  description: string
  estimate: string
  done: boolean
  notes: string
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
  const [isEditingListName, setIsEditingListName] = useState(false)
  const [pendingListName, setPendingListName] = useState('')
  const [taskCards, setTaskCards] = useState<TaskCard[]>([])
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({})
  const { toggleDone, updateEstimate, updateNotes, beginAddSubtask, addSubtask, toggleSubtask } =
    useTaskCardHelpers(setTaskCards, subtaskDrafts, setSubtaskDrafts)
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
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

  function computeDefaultClarifyQuestions(
    t: 'dev' | 'custom',
    g: string,
    c?: string,
    n?: string,
  ): string[] {
    const hay = [g || '', c || '', n || ''].join(' ').toLowerCase()
    const includesDb = /(\bdb\b|database|postgres|mysql|sqlite|mongo|mongodb|prisma|typeorm|sequelize|mongoose|knex|sql|schema|migration|migrations)/i.test(hay)
    if (t === 'dev') {
      const base = [
        'Which files/modules are impacted or should be created?',
        'What acceptance criteria define done for this goal?',
      ]
      if (includesDb) {
        base.push('Which database/ORM and schema/migrations should we use?')
      }
      return base
    }
    return [
      'What exact outcome do you want to achieve?',
      'Any constraints, deadlines, or tools to consider?',
    ]
  }

  function shouldAskPriorWork(g: string, c?: string, n?: string): boolean {
    const text = [g || '', c || '', n || ''].join(' ').toLowerCase()
    // Clear YES signals
    const yesSignals = [
      /\bi (have|\'ve) worked on\b/,
      /\bprevious(ly)?\b/,
      /\bi (built|implemented|did) (this|similar)\b/,
      /\b(done|built) (this|similar) before\b/,
      /\bhave experience (with|in)\b/,
      /\bworked on (this|a similar) (earlier|before)\b/,
    ]
    if (yesSignals.some((r) => r.test(text))) return false
    // Clear NO signals
    const noSignals = [
      /\bnever (done|built|implemented)\b/,
      /\b(haven't|have not) worked on\b/,
      /\bno experience (with|in)\b/,
      /\bfirst time\b/,
      /\bnew to (this|it)\b/,
      /\b(don't|do not) know how\b/,
      /\bunsure how\b/,
    ]
    if (noSignals.some((r) => r.test(text))) return false
    // Heuristic: vague goal + very limited notes/context implies no prior work
    const goalWords = (g || '').trim().split(/\s+/).filter(Boolean).length
    const auxLen = ((c || '').trim().length + (n || '').trim().length)
    const techTokens = [
      /\bpostgres(ql)?\b/i,
      /\bmysql\b/i,
      /\bsqlite\b/i,
      /\bmongo(db)?\b/i,
      /\bprisma\b/i,
      /\btypeorm\b/i,
      /\bsequelize\b/i,
      /\bknex\b/i,
      /\bschema\b/i,
      /\bmigration(s)?\b/i,
      /\btables?\b/i,
      /\bindex(es)?\b/i,
      /\bquery|queries\b/i,
      /\belectron\b/i,
      /\breact\b/i,
      /\bantd|ant design\b/i,
      /\b(ts|tsx|js|jsx)\b/i,
    ]
    const hasTech = techTokens.some((r) => r.test(g || '') || r.test(c || '') || r.test(n || ''))
    if (goalWords <= 6 && auxLen < 40 && !hasTech) {
      return false
    }
    // Ambiguous -> ask
    return true
  }

  async function sendMessage() {
    if (!canSend) return
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: input.trim() }
    setMessages((m) => [...m, userMsg])
    setInput('')
    if (pendingClarify) {
      // Treat this message as answers to the current clarifying question
      const answer = userMsg.content
      setClarifyAnswers((prev) => {
        const next = [...prev]
        next[clarifyStep] = answer
        return next
      })
      const nextStep = clarifyStep + 1
      if (nextStep < clarifyQuestions.length) {
        setClarifyStep(nextStep)
        // Ask the next question
        setMessages((m) => [
          ...m,
          { id: uid(), role: 'assistant', content: clarifyQuestions[nextStep] },
        ])
        return
      }
      // If all questions answered, proceed to generate tasks
      setPendingClarify(false)
      // Build merged context with Q/A pairs appended to original context
      const qa = clarifyQuestions
        .map((q, i) => [`Q${i + 1}: ${q}`, `A${i + 1}: ${clarifyAnswers[i] || ''}`].join('\n'))
        .join('\n')
      setContext([originalContextRef.current, qa].filter(Boolean).join('\n'))
      await (async function generateTasksNowInline() {
        // Reset previous breakdown state immediately and create a request token
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
          // Ignore stale responses if a newer breakdown has started
          if (lastBreakdownToken.current !== token) {
            return
          }
          setTasks(res)
          setTasksProgress(0)
          setTasksTotal(res.length)
          setPendingCreateFromBreakdown(false)
          setShowRightBreakdown(false)
          setMessages((m) => [
            ...m,
            { id: uid(), role: 'assistant', content: `I have ${res.length} suggested tasks. Click "Next task" to review them one by one.` },
          ])
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
      return
    }
    const history = [
      { role: 'system' as const, content: 'You are a concise, supportive coding coach.' },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userMsg.content },
    ]
    const reply = await window.ai.chat(history as any)
    setMessages((m) => [...m, { id: uid(), role: 'assistant', content: reply }])
  }

  async function checkMood() {
    const res = await window.ai.mood(note)
    setMood(res)
    // Persist mood with timestamp
    try {
      await window.db.saveMood({ note, mood: res.mood, motivation: res.motivation, suggestion: res.suggestion })
    } catch {}
  }

  async function makeBreakdown() {
    if (!goal.trim()) return
    // First: ask clarifying questions to improve specificity (always ask at least defaults)
    const clarifyKey = `${taskType}::${goal.trim()}::${(context || '').trim()}::${(note || '').trim()}`
    if (lastClarifyKeyRef.current !== clarifyKey) {
      // New goal/context/note combination; reset any previous clarify state
      setClarifyQuestions([])
      setClarifyAnswers([])
      setClarifyStep(0)
      setPendingClarify(false)
      originalContextRef.current = context
      lastClarifyKeyRef.current = clarifyKey
    }
    let qs: string[] | null = null
    try {
      const prevQA = clarifyQuestions.slice(0, clarifyStep).map((q, i) => ({ q, a: clarifyAnswers[i] }))
      qs = await window.ai.clarify(goal, context, note, taskType, 'Jr Full Stack Developer', prevQA)
    } catch {}
    if (!qs || qs.length < 2) {
      qs = computeDefaultClarifyQuestions(taskType, goal, context, note)
    }
    // Prepend prior-work question if needed
    if (shouldAskPriorWork(goal, context, note)) {
      qs = [
        'Have you worked on a similar goal before? If yes, what did you try and what was the outcome?',
        ...qs.filter((q) => !/worked on a similar goal/i.test(q)),
      ]
    }
    setClarifyQuestions(qs)
    setClarifyAnswers(Array(qs.length).fill(''))
    setClarifyStep(0)
    setPendingClarify(true)
    originalContextRef.current = context
    setMessages((m) => [
      ...m,
      { id: uid(), role: 'assistant', content: `Before I generate tasks, a few quick questions:` },
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
        { id: uid(), role: 'assistant', content: 'That’s all. Should I create new task cards for each of these?' },
      ])
      setPendingCreateFromBreakdown(true)
    }
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }, 0)
  }

  // function copyTasks() {
  //   const text = tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
  //   navigator.clipboard.writeText(text)
  // }

  function handleCreateTasks(confirm: boolean) {
    if (confirm) {
      setCreatedTasks(tasks)
      const name = simplifyGoal(goal)
      setCreatedListName(name)
      // Build task cards
      const cards: TaskCard[] = tasks.map((t) => ({
        id: uid(),
        title: deriveThreeWordTitle(t),
        description: t,
        estimate: '',
        done: false,
        notes: '',
        subtasks: [],
      }))
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
    const cleaned = text
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) return 'New Task'
    const words = cleaned.split(' ').slice(0, 3)
    const titled = words
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
      .join(' ')
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

  return (
    <>
    <div style={{ position: 'fixed', inset: 0, display: 'grid', gridTemplateColumns: '40% 60%', gap: 0, padding: 0 }}>
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
            placeholder="Ask for help, next steps, or guidance..."
            ref={chatInputRef as any}
          />
          {tasksTotal > 0 && tasksProgress < tasksTotal && !pendingCreateFromBreakdown && !loadingTasks && !showRightBreakdown && (
            <Button onClick={showNextTask}>Next task ({tasksProgress + 1}/{tasksTotal})</Button>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, gridColumn: '2', height: '100%', overflow: 'auto', padding: 16, paddingBottom: 96 }}>

        {showMoodPanel && (
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

        {showBreakdownPanel && (
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
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="High-level goal" />
            <Input.TextArea rows={3} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Any context (repo, blockers, constraints)" />
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
              <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
                <Button size="small" onClick={() => {
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
                      setTasks(res)
                      setTasksProgress(0)
                      setTasksTotal(res.length)
                      setPendingCreateFromBreakdown(false)
                      setShowRightBreakdown(false)
                      setMessages((m) => [
                        ...m,
                        { id: uid(), role: 'assistant', content: `I have ${res.length} suggested tasks. Click "Next task" to review them one by one.` },
                      ])
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
                }}>Skip questions</Button>
                <Button size="small" onClick={() => {
                  // Go back one question if possible and ask again
                  if (clarifyStep > 0) {
                    const prev = clarifyStep - 1
                    setClarifyStep(prev)
                    setMessages((m) => [...m, { id: uid(), role: 'assistant', content: clarifyQuestions[prev] }])
                  }
                }} disabled={clarifyStep === 0}>Back</Button>
              </div>
            )}
            {showRightBreakdown && tasks.length > 0 ? (
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
            ) : carouselTaskId && carouselTask && carouselTotal > 0 && carouselCurrent ? (
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
            ) : taskCards.length === 0 ? (
              <Typography.Text type="secondary">No tasks yet. Generate a breakdown to create tasks.</Typography.Text>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                {taskCards.map((card) => (
                  <Card
                    key={card.id}
                    style={{ overflow: 'hidden', background: card.done ? '#f3fff3' : undefined }}
                  >
                    <div style={{ background: card.done ? '#e9fff0' : '#f6f8ff', padding: 12 }}>
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
                        />
                      ) : (
                        <div
                          title={card.description}
                          onClick={() => startEditTitle(card.id, card.title)}
                          style={{ fontWeight: 800, fontSize: 15, color: '#000', cursor: 'text' }}
                        >
                          {card.title}
                        </div>
                      )}
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
                          <Button onClick={() => { beginAddSubtask(card.id) }}>Create sub tasks</Button>
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
            )}
          </div>
        </Card>
        </div>
      </div>
      </div>
      <FloatButton.Group shape="circle" style={{ right: 24, bottom: 24 }} trigger="click" icon={<PlusOutlined />}>
        <FloatButton
          tooltip="Mood check in"
          icon={<SmileOutlined />}
          onClick={() => {
            setShowMoodPanel(true)
          }}
        />
        <FloatButton
          tooltip="Dev task breakdown"
          icon={<CodeOutlined />}
          onClick={() => {
            setTaskType('dev')
            setShowBreakdownPanel(true)
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
  function updateNotes(id: string, notes: string) {
    setTaskCards((cards) => cards.map((c) => (c.id === id ? { ...c, notes } : c)))
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
  return { toggleDone, updateEstimate, updateNotes, beginAddSubtask, addSubtask, renderSubtasks, toggleSubtask }
}
