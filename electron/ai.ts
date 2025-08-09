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
    })
  }
  return openaiClient
}

export async function chatWithAssistant(messages: ChatMessage[]): Promise<string> {
  const client = getOpenAIClient()
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages,
    temperature: 0.4,
  })
  const text = response.choices?.[0]?.message?.content ?? ''
  return text.trim()
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
      const data = JSON.parse(text)
      const tasks = TasksSchema.parse(data)
      return tasks
    } catch {
      return null
    }
  }

  // 1) Direct parse
  let tasks = tryParse(raw)
  if (tasks) return tasks

  // 2) Extract first JSON array substring
  const match = raw.match(/\[[\s\S]*\]/)
  if (match) {
    tasks = tryParse(match[0])
    if (tasks) return tasks
  }

  // 3) Fallback: heuristic line split
  const fallback = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*\d\.\)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 7)
  // Validate fallback minimally
  return fallback.length ? fallback : fallbackBreakdown(goal)
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
            '- Each question must progress toward concrete implementation details.',
            'Output JSON ONLY: an array of strings.',
          ].join('\n')
        : [
            'You are a helpful assistant. Ask 2–4 concise clarifying questions BEFORE planning.',
            '- Clarify objectives, constraints, resources. Avoid repeats.',
            userProfile ? `- The user profile is: ${userProfile}. Keep language approachable.` : '- If no user profile is given, assume a Jr Full Stack Developer and keep language approachable.',
            'Output JSON ONLY: an array of strings.',
          ].join('\n'),
  }
  const qaText = (previousQA || [])
    .map((p, i) => `Q${i + 1}: ${p.q}\nA${i + 1}: ${p.a ?? ''}`)
    .join('\n')
  const user = {
    role: 'user' as const,
    content: [
      `User profile: ${userProfile || 'Jr Full Stack Developer (assumed)'}`,
      `Task type: ${type}`,
      `Goal: ${goal}`,
      context ? `Context: ${context}` : '',
      note ? `Mood note: ${note}` : '',
      previousQA && previousQA.length ? `Previous Q/A:\n${qaText}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  }
  // Lower randomness for clarifications to keep questions focused
  const client = getOpenAIClient()
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [system, user],
    temperature: 0.2,
  })
  const raw = (response.choices?.[0]?.message?.content ?? '').trim()
  try {
    return QuestionsSchema.parse(JSON.parse(raw))
  } catch {
    const match = raw.match(/\[[\s\S]*\]/)
    if (match) {
      try {
        return QuestionsSchema.parse(JSON.parse(match[0]))
      } catch {}
    }
    // Fallback to a couple generic but helpful questions
    return type === 'dev'
      ? [
          'Which files/modules should change for this goal?',
          'What acceptance criteria define done?',
        ]
      : [
          'What is the exact outcome you want?',
          'Any constraints or deadlines to consider?',
        ]
  }
}


