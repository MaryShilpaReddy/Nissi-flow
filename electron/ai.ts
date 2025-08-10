import OpenAI from 'openai'
import { z } from 'zod'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ClarifyQA = { q: string; a?: string }

let openaiClient: OpenAI | null = null

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY in environment')
    }
    openaiClient = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_API_BASE || undefined,
      organization: process.env.OPENAI_ORG_ID || undefined,
      project: process.env.OPENAI_PROJECT_ID || undefined,
    })
  }
  return openaiClient
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableError(err: any): boolean {
  const msg = String(err?.message || err || '')
  const status = (err as any)?.status || (err as any)?.code
  if (status && Number(status) >= 500) return true
  // Treat 429 as retryable only for rate limit, not for true quota exhaustion
  if (status === 429) {
    if (/quota/i.test(msg)) return false
    return true
  }
  // Network/timeout errors are retryable
  if (/(timeout|timed out|ETIMEDOUT|ECONNRESET|EAI_AGAIN)/i.test(msg)) return true
  // Explicit rate limit wording without quota
  if (/rate limit/i.test(msg) && !/quota/i.test(msg)) return true
  return false
}

async function chatCompletionWithRetry(params: {
  messages: ChatMessage[]
  temperature?: number
  response_format?: any
  primaryModel?: string
  maxRetries?: number
  initialDelayMs?: number
}): Promise<{ content: string; usedModel: string }> {
  const client = getOpenAIClient()
  const primary = params.primaryModel || process.env.OPENAI_MODEL || 'gpt-4o-mini'
  // Prefer lighter model first; fall back to a different variant if configured
  const modelChoices = Array.from(
    new Set([primary, 'gpt-4o-mini', process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o'])
  ).filter(Boolean) as string[]
  const maxRetries = params.maxRetries ?? 4
  const baseDelay = params.initialDelayMs ?? 500

  let lastErr: any
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const modelIdx = Math.min(attempt, modelChoices.length - 1)
    const model = modelChoices[modelIdx]
    try {
      const response = await client.chat.completions.create({
        model,
        messages: params.messages as any,
        temperature: params.temperature ?? 0.3,
        response_format: params.response_format as any,
      })
      const content = (response.choices?.[0]?.message?.content ?? '').trim()
      return { content, usedModel: model }
    } catch (err) {
      lastErr = err
      if (attempt < maxRetries - 1 && isRetryableError(err)) {
        const delay = baseDelay * Math.pow(2, attempt)
        await sleep(delay)
        continue
      }
      break
    }
  }
  throw lastErr
}

export async function chatWithAssistant(messages: ChatMessage[]): Promise<string> {
  const { content } = await chatCompletionWithRetry({
    messages,
    temperature: 0.4,
  })
  return content
}

export async function assessMood(note: string): Promise<{ mood: string; motivation: number; suggestion: string }> {
  const system: ChatMessage = {
    role: 'system',
    content:
      'You are a concise wellbeing coach for everyday users. Output JSON with keys mood (one of: energized, steady, stressed, tired, blocked), motivation (0-10), suggestion (single sentence). No extra text.',
  }
  const user: ChatMessage = { role: 'user', content: `Note: ${note}` }
  const raw = await chatWithAssistant([system, user])
  try {
    const parsed = JSON.parse(raw)
    const normalized = {
      mood: String(parsed.mood || 'steady'),
      motivation: Math.max(0, Math.min(10, Number(parsed.motivation ?? 5))),
      suggestion: String(parsed.suggestion || ''),
    }
    return normalized
  } catch {
    return { mood: 'steady', motivation: 5, suggestion: raw.slice(0, 200) }
  }
}

export type TaskType = 'dev' | 'custom'

export async function breakdownTasks(
  goal: string,
  context: string | undefined,
  type: TaskType = 'custom',
): Promise<string[]> {
  console.log('breakdownTasks called with goal:', goal, 'context:', context, 'type:', type);
  const TasksSchema = z.array(z.string().min(1).max(160)).min(3).max(10)
  const fallbackBreakdown = (g: string): string[] => {
    const trimmed = g.trim() || 'the goal'
    if (type === 'dev') {
      return [
        `Clarify acceptance criteria for "${trimmed}"`,
        `Audit code/docs relevant to "${trimmed}"`,
        `Create feature branch for "${trimmed}"`,
        `Implement core logic for "${trimmed}"`,
        `Write unit tests for "${trimmed}"`,
        `Update docs/README for "${trimmed}"`,
        `Open PR and request review for "${trimmed}"`,
      ]
    }
    return [
      `Define success criteria for "${trimmed}"`,
      `List required materials or info for "${trimmed}"`,
      `Schedule focused time for "${trimmed}"`,
      `Complete first concrete step for "${trimmed}"`,
      `Review progress and adjust plan for "${trimmed}"`,
      `Document notes or outcomes for "${trimmed}"`,
      `Share or reflect on results for "${trimmed}"`,
    ]
  }
  const system: ChatMessage = {
    role: 'system',
    content:
      type === 'dev'
        ? [
            'You are a senior tech lead. Produce 3-7 highly actionable, stack-specific development tasks.',
            '- Strictly tailor tasks to the provided stack and context (frameworks, language, build tool, folder names, file paths, APIs).',
            '- Use concrete identifiers: exact file paths, components, functions, env vars, CLI commands.',
            '- Prefer tasks that modify a specific artifact or run a specific command.',
            '- Avoid generic phrasing like "implement feature" or "write tests" without scope/file/module.',
            '- Scope each task to ~30–90 minutes. Keep under 12 words.',
            '- If context includes Electron/React/Vite/Ant Design/etc., reference those explicitly.',
            '- Infer stack hints from goal/context when possible (e.g., src/App.tsx, package.json scripts).',
            'Output JSON ONLY: an array of strings (no markdown, no prose).',
            '',
            'Examples (format/style only):',
            '- Update src/App.tsx: add AntD FloatButton group',
            '- Wire ipcMain handler ai:breakdown in electron/main.ts',
            '- Expose window.db.saveMood in electron/preload.ts',
            '- Add OPENAI_MODEL env and read in electron/ai.ts',
            '- Write unit test for breakdownTasks in electron/ai.test.ts',
          ].join('\n')
        : [
            'You are a helpful personal assistant. Break the provided goal into 3-7 highly actionable, concrete steps.',
            '- Each step should be specific, clear, and doable in ~30–90 minutes.',
            '- Prefer imperative phrasing and include practical specifics when helpful.',
            '- Keep each item under 12 words.',
            'Output JSON ONLY: an array of strings (no markdown, no prose).',
          ].join('\n'),
  }
  const userText = `Goal: ${goal}\nContext: ${context ?? ''}`
  let raw: string
  try {
    raw = await chatWithAssistant([system, { role: 'user', content: userText }])
  } catch (err: any) {
    // On quota/429 or any error, return a decent fallback set of tasks
    return fallbackBreakdown(goal)
  }
  // Try direct JSON parse first
  const tryParse = (text: string): string[] | null => {
    try {
      console.log('Attempting to parse:', text);
      const data = JSON.parse(text)
      console.log('Parsed JSON data:', data);
      const tasks = TasksSchema.parse(data)
      console.log('Validated tasks:', tasks);
      return tasks
    } catch (error) {
      console.error('Parse error:', error);
      return null
    }
  }

  // 1) Direct parse
  let tasks = tryParse(raw)
  if (tasks) {
    console.log('Successfully parsed tasks directly:', tasks);
    return tasks;
  }

  // 2) Extract first JSON array substring
  const match = raw.match(/\[\s\S]*\]/)
  if (match) {
    console.log('Found JSON array substring:', match[0]);
    tasks = tryParse(match[0])
    if (tasks) {
      console.log('Successfully parsed tasks from substring:', tasks);
      return tasks;
    }
  }

  // 3) Fallback: heuristic line split
  console.log('Attempting fallback heuristic line split');
  const fallback = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*\d\.\)\s]+/, '').trim())
    .filter((line) => {
      // Validate each line is a non-empty string and not just punctuation
      const isValid = Boolean(line && typeof line === 'string' && line.length > 0 && /\w/.test(line));
      if (!isValid && line) {
        console.warn('Filtering out invalid line:', line);
      }
      return isValid;
    })
    .slice(0, 7)
  
  console.log('Fallback results:', fallback);
  
  // Validate fallback minimally
  if (fallback.length) {
    console.log('Using fallback results:', fallback);
    return fallback;
  } else {
    console.log('Using default fallback breakdown for goal:', goal);
    return fallbackBreakdown(goal);
  }
}

export async function clarifyTasks(
  goal: string,
  context: string | undefined,
  note: string | undefined,
  type: TaskType = 'custom',
  userProfile?: string,
  previousQA?: ClarifyQA[],
): Promise<string[]> {
  const QuestionsSchema = z.array(z.string().min(3).max(140)).min(1).max(5)
  const haystack = [goal, context || '', note || ''].join(' ').toLowerCase()
  const includesDb = /(\bdb\b|database|postgres|mysql|sqlite|mongo|mongodb|prisma|typeorm|sequelize|mongoose|knex|sql|schema|migration|migrations)/i.test(haystack)
  const system: ChatMessage = {
    role: 'system',
    content:
      type === 'dev'
        ? [
            'You are a senior tech lead. Ask 2–4 concise, non-redundant clarifying questions BEFORE planning.',
            '- Tailor to the user level. Use approachable language.',
            '- Focus on stack, files/modules, acceptance criteria, dependencies, env vars, blockers, scope.',
            includesDb
              ? '- The goal mentions data or a database. Include at least one question about database engine/version, ORM/driver, schema/migrations, and connection env vars.'
              : '- If data persistence might be involved, consider asking about database engine/version, ORM/driver, schema/migrations, and connection env vars.',
            userProfile ? `- The user profile is: ${userProfile}. Tailor questions to their level.` : '- If no user profile is given, assume a Jr Full Stack Developer. Tailor questions accordingly.',
            previousQA && previousQA.length
              ? '- Do not repeat anything already covered in previous Q/A below.'
              : '- Avoid generic or repetitive questions.',
            '- If prior experience with similar goals is unclear, include a question asking whether they worked on a similar goal before and what they tried.',
            '- Each question must progress toward concrete implementation details.',
            'Return JSON ONLY as an object with key "questions": {"questions":["..."]}. No prose, no numbering, no markdown.',
          ].join('\n')
        : [
            'You are a helpful assistant. Ask 2–4 concise clarifying questions BEFORE planning.',
            '- Clarify objectives, constraints, resources. Avoid repeats.',
            userProfile ? `- The user profile is: ${userProfile}. Keep language approachable.` : '- If no user profile is given, assume a Jr Full Stack Developer and keep language approachable.',
            '- If prior experience with similar goals is unclear, include a question about prior attempts and results.',
            'Return JSON ONLY as an object with key "questions": {"questions":["..."]}. No prose, no numbering, no markdown.',
          ].join('\n'),
  }
  const qaText = (previousQA || [])
    .map((p, i) => `Q${i + 1}: ${p.q}\nA${i + 1}: ${p.a ?? ''}`)
    .join('\n')
  // Build a more meaningful, contextual prompt
  const contextSummary = [
    goal && `The user wants to: ${goal}`,
    context && `They have this context: ${context}`,
    note && `Additional notes: ${note}`,
    `Task type: ${type}`,
    `User profile: ${userProfile || 'Jr Full Stack Developer (assumed)'}`
  ].filter(Boolean).join('. ')
  
  const user = {
    role: 'user' as const,
    content: [
      contextSummary,
      '',
      previousQA && previousQA.length ? `Previous Q/A:\n${qaText}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  }
  // Lower randomness for clarifications to keep questions focused
  const { content: raw } = await chatCompletionWithRetry({
    messages: [system, user],
    temperature: 0.2,
    response_format: { type: 'json_object' as any },
  })
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return QuestionsSchema.parse(parsed)
    }
    if (parsed && Array.isArray((parsed as any).questions)) {
      return QuestionsSchema.parse((parsed as any).questions)
    }
    // Fallthrough to extraction
  } catch {
    // Try to extract a JSON array substring
  }
  const match = raw.match(/\[[\s\S]*?\]/)
  if (match) {
    try {
      const arr = JSON.parse(match[0])
      if (Array.isArray(arr)) {
        return QuestionsSchema.parse(arr)
      }
    } catch {}
  }
  // Last resort: extract lines that look like bullets or numbered items
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[\-*\d\.\)]\s+/, '').trim())
    .filter((l) => l.length > 0 && l.length <= 140)
  const unique: string[] = []
  for (const l of lines) {
    if (!unique.includes(l)) unique.push(l)
    if (unique.length >= 5) break
  }
  if (unique.length > 0) {
    return QuestionsSchema.parse(unique)
  }
  // No static defaults; defer to UI to ask the user for more details
  return []
}

export async function clarifyTasksRaw(
  goal: string,
  context: string | undefined,
  note: string | undefined,
  type: TaskType = 'custom',
  userProfile?: string,
  previousQA?: ClarifyQA[],
): Promise<string> {
  const system: ChatMessage = {
    role: 'system',
    content:
      type === 'dev'
        ? [
            'You are a senior tech lead. Ask concise clarifying questions BEFORE planning.',
            '- Tailor to the user level and be specific to the stack.',
            '- Focus on files/modules, acceptance criteria, dependencies, env vars, blockers, scope.',
            '- If DB may be involved, ask about engine/version, ORM/driver, schema/migrations, connection env vars.',
            '- If prior experience is unclear, include a question about previous attempts and outcomes.',
          ].join('\n')
        : [
            'You are a helpful assistant. Ask concise clarifying questions BEFORE planning.',
            '- Clarify concrete outcomes, constraints, resources; avoid repetition.',
            '- If prior experience is unclear, include a question about previous attempts and outcomes.',
          ].join('\n'),
  }
  const qaText = (previousQA || [])
    .map((p, i) => `Q${i + 1}: ${p.q}\nA${i + 1}: ${p.a ?? ''}`)
    .join('\n')
  // Build a more meaningful, contextual prompt
  const contextSummary = [
    goal && `The user wants to: ${goal}`,
    context && `They have this context: ${context}`,
    note && `Additional notes: ${note}`,
    `Task type: ${type}`,
    `User profile: ${userProfile || 'Software Developer'}`
  ].filter(Boolean).join('. ')
  
  const user: ChatMessage = {
    role: 'user',
    content: [
      contextSummary,
      '',
      previousQA && previousQA.length ? `Previous Q/A:\n${qaText}` : '',
      '',
      'Please ask your clarifying questions now.',
    ]
      .filter(Boolean)
      .join('\n'),
  }
  const { content } = await chatCompletionWithRetry({
    messages: [system, user],
    temperature: 0.3,
  })
  return content
}


