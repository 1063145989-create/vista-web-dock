const workspaceKey = 'vista-workspace-v1'
const activityLimit = 80
let activeSession = null

const defaultGroups = [
  { id: 'inbox', title: '收件箱', color: '#3478f6', inbox: true },
  { id: 'work', title: '产品设计', color: '#fa6d4d' },
  { id: 'learn', title: '内容研究', color: '#f2c54e' },
  { id: 'tools', title: '常用工具', color: '#54b89b' },
]

function storageGet(key) {
  return new Promise((resolve) => chrome.storage.local.get(key, (items) => resolve(items[key])))
}

function storageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set({ [workspaceKey]: value }, resolve))
}

function hostFromUrl(url) {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

function colorForHost(host) {
  const palette = ['#c9e8dd', '#f7dd95', '#cbd2f6', '#e9c5da', '#d1e3bc', '#f8d1bd']
  return palette[[...host].reduce((value, character) => value + character.charCodeAt(0), 0) % palette.length]
}

function addActivity(workspace, site, at = Date.now()) {
  const entries = Array.isArray(workspace.activity) ? workspace.activity : []
  const latest = entries[0]
  if (latest?.siteId !== site.id || at - latest.at > 45_000) {
    entries.unshift({ siteId: site.id, at })
    site.count = (site.count || 0) + 1
  }
  workspace.activity = entries.slice(0, activityLimit)
  site.last = 0
  site.lastOpenedAt = at
}

async function flushActiveSession(now = Date.now()) {
  if (!activeSession) return
  const elapsedMinutes = Math.floor((now - activeSession.startedAt) / 60_000)
  if (elapsedMinutes > 0) {
    const workspace = await storageGet(workspaceKey)
    const site = workspace?.sites?.find((item) => item.id === activeSession.siteId)
    if (site) {
      site.minutes = (site.minutes || 0) + elapsedMinutes
      await storageSet(workspace)
    }
  }
  activeSession = null
}

async function collectCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  const host = hostFromUrl(tab?.url || '')
  if (!host) throw new Error('当前页面无法收集')

  const workspace = await storageGet(workspaceKey) || {}
  const groups = workspace.groups?.length ? workspace.groups : structuredClone(defaultGroups)
  const sites = Array.isArray(workspace.sites) ? workspace.sites : []
  const existing = sites.find((site) => site.host === host)
  const site = existing || {
    id: `site-${Date.now()}`,
    label: String(tab.title || host).trim().slice(0, 48),
    host,
    url: tab.url,
    group: groups.find((group) => group.inbox)?.id || groups[0].id,
    count: 0,
    minutes: 0,
    last: 999,
    color: colorForHost(host),
  }
  if (!existing) sites.unshift(site)
  site.url = tab.url
  addActivity(workspace, site)

  await storageSet({ ...workspace, schemaVersion: 2, groups, sites, stacks: workspace.stacks || [], activity: workspace.activity })
  return { label: site.label }
}

async function recordKnownVisit(tabId) {
  const now = Date.now()
  await flushActiveSession(now)
  const tab = await chrome.tabs.get(tabId)
  const host = hostFromUrl(tab.url || '')
  if (!host) return
  const workspace = await storageGet(workspaceKey)
  const site = workspace?.sites?.find((item) => item.host === host)
  if (!site) return

  addActivity(workspace, site, now)
  await storageSet(workspace)
  activeSession = { tabId, siteId: site.id, startedAt: now }
}

async function ensureVistaBookmark() {
  const url = chrome.runtime.getURL('index.html')
  const tree = await new Promise((resolve) => chrome.bookmarks.getTree(resolve))
  const bookmarks = []
  const walk = (nodes) => nodes?.forEach((node) => {
    if (node.url) bookmarks.push(node)
    else walk(node.children)
  })
  walk(tree)
  if (bookmarks.some((bookmark) => bookmark.url === url)) return
  const bookmarkBar = tree[0]?.children?.find((node) => node.id === '1') || tree[0]?.children?.[0]
  if (bookmarkBar) await chrome.bookmarks.create({ parentId: bookmarkBar.id, title: 'VISTA 工作台', url })
}

chrome.runtime.onInstalled.addListener(() => {
  ensureVistaBookmark().catch(() => {})
})

chrome.runtime.onStartup.addListener(() => {
  ensureVistaBookmark().catch(() => {})
})

ensureVistaBookmark().catch(() => {})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'collect-current-page') return
  collectCurrentPage().then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: error.message })
  )
  return true
})

chrome.tabs.onActivated.addListener(({ tabId }) => {
  recordKnownVisit(tabId).catch(() => {})
})

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeSession?.tabId === tabId) flushActiveSession().catch(() => {})
})
