const defaultGroups = [
  { id: 'inbox', title: '收件箱', color: '#3478f6', inbox: true },
  { id: 'work', title: '产品设计', color: '#fa6d4d' },
  { id: 'learn', title: '内容研究', color: '#f2c54e' },
  { id: 'tools', title: '常用工具', color: '#54b89b' },
]

const defaultSites = []
const legacySeedSiteIds = new Set(['openai', 'miro', 'figma', 'linear', 'notion', 'slack', 'github', 'chatgpt', 'raycast', 'drive', 'medium', 'a16z', 'youtube', 'nytimes', 'calendar', 'spotify', 'douban', 'xiaohongshu'])
const defaultWorkspaceName = '我的网页工作空间'

let groups = structuredClone(defaultGroups)
let sites = structuredClone(defaultSites)
let stacks = []
let activity = []
let workspaceName = defaultWorkspaceName
const workspaceStorageKey = 'vista-workspace-v1'
const isExtension = Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome?.storage?.local)
const canImportBookmarks = Boolean(isExtension && globalThis.chrome?.bookmarks?.getTree)
let workspaceReady = false
let persistTimer = 0
let lastWorkspacePayload = ''

const state = { filter: 'all', search: '', activeGroup: null, selected: null, compact: false, view: 'dock', editing: false, openStack: null }
let editingSiteId = null
const columns = document.querySelector('#dock-columns')
const groupNav = document.querySelector('#group-nav')
const dialog = document.querySelector('#site-dialog')
const groupDialog = document.querySelector('#group-dialog')
const commandDialog = document.querySelector('#command-dialog')
const backgroundDialog = document.querySelector('#background-dialog')
const workspaceNameDialog = document.querySelector('#workspace-name-dialog')
const workspaceTitle = document.querySelector('#workspace-title')
const searchInput = document.querySelector('#search')
const commandInput = document.querySelector('#command-input')
const commandResults = document.querySelector('#command-results')
const workspace = document.querySelector('.workspace')
const backgroundLayer = document.querySelector('#workspace-background')
const backgroundImageElement = document.querySelector('#workspace-background-image')
const backgroundPreview = document.querySelector('#background-preview')
const backgroundPreviewLabel = document.querySelector('#background-preview-label')
const backgroundFile = document.querySelector('#background-file')
const backgroundOpacity = document.querySelector('#background-opacity')
const backgroundOpacityValue = document.querySelector('#background-opacity-value')
const backgroundStatus = document.querySelector('#background-status')
const flowCanvas = document.querySelector('#flow-canvas')
const flowToggle = document.querySelector('#toggle-flow')
const continueSites = document.querySelector('#continue-sites')
const continueWork = document.querySelector('.continue-work')
const weekMeter = document.querySelector('.week-meter')
const stackTray = document.querySelector('#stack-tray')
const inboxActions = document.querySelector('#inbox-actions')
const timelineView = document.querySelector('#timeline-view')
const timelineTrack = document.querySelector('#timeline-track')

const time = (minutes = 0) => minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`

function siteMonogram(site) {
  const value = String(site?.label || site?.host || '?').trim()
  const letter = Array.from(value)[0]?.toLocaleUpperCase('zh-CN') || '?'
  const escaped = letter.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
  return `<span class="site-monogram" aria-hidden="true">${escaped}</span>`
}

function isQuietSite(site) {
  return Number.isFinite(site.lastOpenedAt) && site.lastOpenedAt <= Date.now() - 30 * 24 * 60 * 60 * 1000
}

function workspaceSnapshot() {
  return { schemaVersion: 2, name: workspaceName, groups, sites, stacks, activity }
}

function validWorkspace(value) {
  return Array.isArray(value?.groups) && Array.isArray(value?.sites) && Array.isArray(value?.stacks)
}

function normalizeWorkspace(snapshot) {
  const normalized = {
    schemaVersion: snapshot.schemaVersion || 1,
    name: String(snapshot.name || '').trim().slice(0, 32) || defaultWorkspaceName,
    groups: snapshot.groups,
    sites: snapshot.sites,
    stacks: snapshot.stacks,
    activity: Array.isArray(snapshot.activity) ? snapshot.activity : [],
  }
  if (normalized.schemaVersion < 2) {
    normalized.sites = normalized.sites.map((site) => legacySeedSiteIds.has(site.id)
      ? { ...site, count: 0, minutes: 0, last: 999, lastOpenedAt: null }
      : site)
    normalized.activity = []
    normalized.schemaVersion = 2
  }
  return normalized
}

function readChromeStorage(key) {
  return new Promise((resolve) => chrome.storage.local.get(key, (items) => resolve(items[key])))
}

function writeChromeStorage(value) {
  return new Promise((resolve) => chrome.storage.local.set({ [workspaceStorageKey]: value }, resolve))
}

async function restoreWorkspace() {
  try {
    const saved = isExtension
      ? await readChromeStorage(workspaceStorageKey)
      : JSON.parse(localStorage.getItem(workspaceStorageKey) || 'null')
    if (validWorkspace(saved)) {
      const normalized = normalizeWorkspace(saved)
      groups = normalized.groups
      sites = normalized.sites
      stacks = normalized.stacks
      activity = normalized.activity
      workspaceName = normalized.name
      lastWorkspacePayload = JSON.stringify(saved)
    }
  } catch {
    // A missing or malformed local snapshot must not prevent the workspace from opening.
  }
  workspaceReady = true
}

function scheduleWorkspaceSave() {
  if (!workspaceReady) return
  window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(async () => {
    const snapshot = workspaceSnapshot()
    const payload = JSON.stringify(snapshot)
    if (payload === lastWorkspacePayload) return
    lastWorkspacePayload = payload
    try {
      if (isExtension) await writeChromeStorage(snapshot)
      else localStorage.setItem(workspaceStorageKey, payload)
    } catch {
      // The UI stays usable even when browser storage is temporarily unavailable.
    }
  }, 120)
}

function colorForHost(host) {
  const palette = ['#c9e8dd', '#f7dd95', '#cbd2f6', '#e9c5da', '#d1e3bc', '#f8d1bd']
  return palette[[...host].reduce((value, character) => value + character.charCodeAt(0), 0) % palette.length]
}

function hostFromUrl(url) {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

function urlForSite(site) {
  const savedUrl = String(site?.url || '').trim()
  if (/^https?:\/\//i.test(savedUrl)) return savedUrl
  const host = String(site?.host || '').trim().replace(/^https?:\/\//i, '').replace(/^\/+|\/+$/g, '')
  return host ? `https://${host}` : ''
}

function openSite(site) {
  const url = urlForSite(site)
  if (!url) return
  state.selected = site.id
  renderInsights()
  renderColumns()
  if (isExtension && chrome.tabs?.create) chrome.tabs.create({ url })
  else window.open(url, '_blank', 'noopener')
}

function uniqueGroupId(title, index) {
  const base = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'bookmarks'
  return `bookmarks-${base}-${index}`
}

async function importBrowserBookmarks() {
  if (!canImportBookmarks) return 0
  const tree = await new Promise((resolve) => chrome.bookmarks.getTree(resolve))
  const importedHosts = new Set(sites.map((site) => site.host))
  let imported = 0
  let groupIndex = 0

  function addBookmark(bookmark, groupId) {
    const host = hostFromUrl(bookmark.url || '')
    if (!host || importedHosts.has(host)) return
    sites.push({
      id: `bookmark-${bookmark.id}-${Date.now()}`,
      label: String(bookmark.title || host).trim().slice(0, 48),
      host,
      url: bookmark.url,
      group: groupId,
      count: 0,
      minutes: 0,
      last: 999,
      color: colorForHost(host),
    })
    importedHosts.add(host)
    imported += 1
  }

  function walk(nodes, groupId) {
    nodes?.forEach((node) => {
      if (node.url) addBookmark(node, groupId)
      else walk(node.children, groupId)
    })
  }

  const roots = tree[0]?.children || []
  roots.forEach((root) => {
    const directBookmarks = root.children?.some((node) => node.url)
    const nestedFolders = root.children?.filter((node) => !node.url && node.children?.length) || []
    const defaultGroup = groups.find((group) => group.inbox)?.id || groups[0].id
    if (directBookmarks) walk(root.children?.filter((node) => node.url), defaultGroup)
    nestedFolders.forEach((folder) => {
      const id = uniqueGroupId(folder.title || '书签', groupIndex++)
      groups.push({ id, title: String(folder.title || '书签').slice(0, 12), color: '#885cf6' })
      walk(folder.children, id)
    })
  })

  return imported
}

function currentSites() {
  const query = state.search.trim().toLowerCase()
  if (query) {
    return sites.filter((site) => {
      const group = groups.find((item) => item.id === site.group)
      return `${site.label} ${site.host} ${group?.title || ''}`.toLowerCase().includes(query)
    })
  }

  let visible = sites
  if (state.activeGroup) visible = visible.filter((site) => site.group === state.activeGroup)
  if (state.filter === 'frequent') visible = visible.filter((site) => site.count >= 3).sort((a, b) => b.count - a.count)
  if (state.filter === 'recent') visible = visible.filter((site) => site.last <= 3).sort((a, b) => a.last - b.last)
  if (state.filter === 'quiet') visible = visible.filter(isQuietSite).sort((a, b) => a.lastOpenedAt - b.lastOpenedAt)
  return visible
}

function renderGroupNav() {
  groupNav.innerHTML = groups.map((group) => `<button type="button" data-group="${group.id}" class="${state.activeGroup === group.id ? 'is-current' : ''}"><i class="group-dot" style="background:${group.color}"></i>${group.title}<span class="group-count">${sites.filter((site) => site.group === group.id).length}</span></button>`).join('')
  groupNav.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
    state.activeGroup = state.activeGroup === button.dataset.group ? null : button.dataset.group
    state.filter = 'all'
    openDockView()
    render()
  }))
}

function tile(site) {
  const selected = site.id === state.selected ? 'is-selected' : ''
  const recent = site.last === 0 ? '<i class="visit-dot" title="今天打开"></i>' : ''
  const editing = state.editing ? '<span class="tile-edit-mark" aria-hidden="true">⋮⋮</span>' : ''
  return `<button type="button" draggable="${state.editing}" class="site-tile ${selected}" data-site="${site.id}" aria-label="${site.label}，${site.count} 次访问"><span class="favicon-wrap" style="--tile-color:${site.color}">${siteMonogram(site)}</span>${recent}${editing}<strong>${site.label}</strong><small>${site.host.replace('www.', '')}</small></button>`
}

function stackTile(stack) {
  const stackSites = stack.siteIds.map((id) => sites.find((site) => site.id === id)).filter(Boolean)
  const faces = stackSites.slice(0, 3).map((site) => `<span class="stack-face" style="--tile-color:${site.color}">${siteMonogram(site)}</span>`).join('')
  return `<button type="button" class="stack-tile ${state.openStack === stack.id ? 'is-open' : ''}" data-stack="${stack.id}" aria-expanded="${state.openStack === stack.id}"><span class="stack-faces">${faces}</span><span class="stack-copy"><strong>${stack.title}</strong><small>${stackSites.length} 个网页 · ${stack.label}</small></span><span class="stack-count">${stackSites.length}</span></button>`
}

function renderColumns() {
  const visible = currentSites()
  const relevantGroups = state.filter === 'all' && !state.search && !state.activeGroup ? groups : groups.filter((group) => visible.some((site) => site.group === group.id) || state.activeGroup === group.id)
  columns.innerHTML = relevantGroups.map((group) => {
    const groupSites = visible.filter((site) => site.group === group.id)
    const groupStacks = !state.search && (state.activeGroup === null || state.activeGroup === group.id) ? stacks.filter((item) => item.group === group.id) : []
    const stackSiteIds = new Set(groupStacks.flatMap((stack) => stack.siteIds))
    const looseSites = groupSites.filter((site) => !stackSiteIds.has(site.id))
    const subtitle = group.inbox ? '待归类' : '任务空间'
    return `<section class="dock-group ${group.inbox ? 'is-inbox' : ''}" data-drop-group="${group.id}" style="--group-color:${group.color}"><div class="group-heading"><div class="group-heading-copy"><h3>${group.title}</h3><small>${subtitle}</small></div><span>${groupSites.length} 个网页</span></div><div class="site-grid">${groupStacks.map(stackTile).join('')}${looseSites.map(tile).join('')}</div></section>`
  }).join('')
  document.querySelector('#empty-state').hidden = visible.length > 0
  bindSiteTileInteractions(columns)
  columns.querySelectorAll('.stack-tile').forEach((button) => button.addEventListener('click', () => {
    state.openStack = state.openStack === button.dataset.stack ? null : button.dataset.stack
    renderColumns()
    renderStackTray()
    if (state.openStack) window.requestAnimationFrame(() => stackTray.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }))
  columns.querySelectorAll('.stack-tile').forEach((button) => {
    button.addEventListener('dragover', (event) => {
      if (!state.editing) return
      event.preventDefault()
      button.classList.add('is-stack-target')
    })
    button.addEventListener('dragleave', () => button.classList.remove('is-stack-target'))
    button.addEventListener('drop', (event) => {
      event.preventDefault()
      event.stopPropagation()
      button.classList.remove('is-stack-target')
      if (!state.editing) return
      addSiteToStack(event.dataTransfer.getData('text/site-id'), button.dataset.stack)
    })
  })
  columns.querySelectorAll('.dock-group').forEach((group) => {
    group.addEventListener('dragover', (event) => { if (!state.editing) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; group.classList.add('is-over') })
    group.addEventListener('dragleave', () => group.classList.remove('is-over'))
    group.addEventListener('drop', (event) => {
      event.preventDefault()
      group.classList.remove('is-over')
      if (!state.editing) return
      const id = event.dataTransfer.getData('text/site-id')
      const site = sites.find((item) => item.id === id)
      if (!site) return
      const removedFromStack = removeSiteFromStack(id)
      if (removedFromStack || site.group !== group.dataset.dropGroup) {
        site.group = group.dataset.dropGroup
        render()
      }
    })
  })
}

function bindSiteTileInteractions(container) {
  container.querySelectorAll('.site-tile').forEach((button) => {
    let longPress
    button.addEventListener('click', () => {
      const site = sites.find((item) => item.id === button.dataset.site)
      if (!site) return
      if (state.editing) {
        state.selected = site.id
        renderInsights()
        renderColumns()
        return
      }
      openSite(site)
    })
    button.addEventListener('pointerdown', () => { longPress = window.setTimeout(() => setEditMode(true), 520) })
    ;['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => button.addEventListener(type, () => window.clearTimeout(longPress)))
    button.addEventListener('dragstart', (event) => {
      if (!state.editing) {
        event.preventDefault()
        return
      }
      event.dataTransfer.setData('text/site-id', button.dataset.site)
      event.dataTransfer.effectAllowed = 'move'
      button.classList.add('is-dragging')
    })
    button.addEventListener('dragend', () => button.classList.remove('is-dragging'))
    button.addEventListener('dragover', (event) => {
      if (!state.editing) return
      event.preventDefault()
      button.classList.add('is-stack-target')
    })
    button.addEventListener('dragleave', () => button.classList.remove('is-stack-target'))
    button.addEventListener('drop', (event) => {
      event.preventDefault()
      event.stopPropagation()
      button.classList.remove('is-stack-target')
      if (!state.editing) return
      const sourceId = event.dataTransfer.getData('text/site-id')
      if (sourceId && sourceId !== button.dataset.site) createStack(sourceId, button.dataset.site)
    })
  })
}

function renderInsights() {
  const selected = sites.find((site) => site.id === state.selected) || sites[0] || null
  const used = [...sites].filter((site) => (site.count || 0) > 0).sort((a, b) => b.count - a.count)[0]
  document.querySelector('#most-used').innerHTML = used ? `${used.count || 0}<span>次</span>` : '—'
  document.querySelector('#most-used-name').textContent = used ? used.label : '尚无使用记录'
  document.querySelector('#quiet-count').textContent = sites.filter(isQuietSite).length
  const quietCount = sites.filter(isQuietSite).length
  document.querySelector('#tidy-copy').textContent = quietCount ? `有 ${quietCount} 个网页已经超过 30 天未打开。` : '收集网页后，这里会提示待整理项。'
  const selectedSite = document.querySelector('#selected-site')
  selectedSite.hidden = !selected
  if (selected) {
    selectedSite.innerHTML = `<p class="selected-site-label">刚刚选中</p><div class="selected-site-info"><span class="favicon-wrap" style="--tile-color:${selected.color}">${siteMonogram(selected)}</span><div><strong>${selected.label}</strong><span>${selected.host}</span></div><button type="button" class="selected-site-edit" data-edit-site="${selected.id}">编辑</button><button type="button" class="selected-site-delete" data-delete-site="${selected.id}">删除</button></div><div class="site-detail"><span>本周 <b>${selected.count || 0} 次</b></span><span>停留 <b>${time(selected.minutes || 0)}</b></span></div>`
    selectedSite.querySelector('[data-edit-site]').addEventListener('click', () => openDialog(selected))
    selectedSite.querySelector('[data-delete-site]').addEventListener('click', () => deleteSite(selected.id))
  }
  const isInbox = selected?.group === 'inbox'
  inboxActions.hidden = !isInbox
  if (isInbox) inboxActions.innerHTML = `<p>快速决定</p><div><button type="button" data-inbox-action="work">归入产品设计</button><button type="button" data-inbox-action="later">稍后处理</button><button type="button" data-inbox-action="archive">不再保留</button></div>`
  inboxActions.querySelectorAll('[data-inbox-action]').forEach((button) => button.addEventListener('click', () => applyInboxAction(button.dataset.inboxAction)))
}

function renderHeading() {
  const titles = { all: '今天的网页', frequent: '高频访问', recent: '最近打开', quiet: '待整理' }
  const isSearching = Boolean(state.search.trim())
  document.querySelector('#stage-title').textContent = isSearching ? '搜索结果' : state.activeGroup ? groups.find((item) => item.id === state.activeGroup).title : titles[state.filter]
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.filter === state.filter && !state.activeGroup && !isSearching))
  document.querySelector('.workspace').classList.toggle('compact', state.compact)
  document.querySelector('.workspace').classList.toggle('is-editing', state.editing)
  document.querySelector('.workspace').classList.toggle('is-timeline', state.view === 'timeline')
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('is-selected', tab.dataset.view === state.view))
  document.querySelector('#toggle-edit').setAttribute('aria-pressed', String(state.editing))
  document.querySelector('#toggle-edit').textContent = state.editing ? '完成整理' : '整理'
  document.querySelector('#toggle-edit').hidden = state.view === 'timeline'
  workspaceTitle.textContent = workspaceName
  document.title = `VISTA - ${workspaceName}`
}

function renderContinueWork() {
  const seen = new Set()
  const resumeSites = activity
    .toSorted((a, b) => b.at - a.at)
    .map((entry) => sites.find((site) => site.id === entry.siteId))
    .filter((site) => site && !seen.has(site.id) && seen.add(site.id))
    .slice(0, 3)
  continueWork.hidden = resumeSites.length === 0
  if (!resumeSites.length) return
  const latest = activity.toSorted((a, b) => b.at - a.at)[0]
  const latestGroup = groups.find((group) => group.id === resumeSites[0].group)
  document.querySelector('#continue-context').textContent = `${latestGroup?.title || '收件箱'} · ${new Date(latest.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  continueSites.innerHTML = resumeSites.map((site, index) => `<button type="button" class="continue-site" data-site="${site.id}"><span class="resume-index">0${index + 1}</span><span class="favicon-wrap" style="--tile-color:${site.color}">${siteMonogram(site)}</span><span><strong>${site.label}</strong><small>${site.host}</small></span></button>`).join('')
  continueSites.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
    const site = sites.find((item) => item.id === button.dataset.site)
    if (!site) return
    state.selected = site.id
    state.activeGroup = site.group
    openDockView()
    render()
  }))
}

function renderStackTray() {
  const stack = stacks.find((item) => item.id === state.openStack)
  stackTray.hidden = !stack
  if (!stack) return
  const stackSites = stack.siteIds.map((id) => sites.find((site) => site.id === id)).filter(Boolean)
  stackTray.innerHTML = `<div class="stack-tray-heading"><div><p class="eyebrow">STACK OPEN</p><h3>${stack.title}</h3></div><div class="stack-tray-actions"><button type="button" class="stack-action" id="rename-stack">命名</button><button type="button" class="stack-action" id="split-stack">拆开</button><button type="button" class="icon-button" id="close-stack" aria-label="关闭 Stack">×</button></div></div><div class="stack-tray-sites">${stackSites.map(tile).join('')}</div>`
  stackTray.querySelector('#close-stack').addEventListener('click', () => { state.openStack = null; renderColumns(); renderStackTray() })
  stackTray.querySelector('#rename-stack').addEventListener('click', () => {
    const title = window.prompt('为这个 Stack 命名', stack.title)
    if (!title?.trim()) return
    stack.title = title.trim().slice(0, 24)
    renderColumns()
    renderStackTray()
  })
  stackTray.querySelector('#split-stack').addEventListener('click', () => {
    stacks = stacks.filter((item) => item.id !== stack.id)
    state.openStack = null
    renderColumns()
    renderStackTray()
  })
  bindSiteTileInteractions(stackTray)
}

function createStack(sourceId, targetId) {
  const source = sites.find((site) => site.id === sourceId)
  const target = sites.find((site) => site.id === targetId)
  if (!source || !target) return

  const sourceStack = stacks.find((stack) => stack.siteIds.includes(sourceId))
  const targetStack = stacks.find((stack) => stack.siteIds.includes(targetId))
  if (sourceStack && targetStack && sourceStack.id === targetStack.id) return
  if (targetStack) {
    addSiteToStack(sourceId, targetStack.id)
    return
  }
  if (sourceStack) {
    addSiteToStack(targetId, sourceStack.id)
    return
  }

  source.group = target.group
  const group = groups.find((item) => item.id === target.group)
  const stack = {
    id: `stack-${Date.now()}`,
    group: target.group,
    title: `${target.label} Stack`,
    label: group?.title || '网页分组',
    siteIds: [target.id, source.id],
    color: group?.color || target.color,
  }
  stacks.push(stack)
  state.openStack = stack.id
  state.selected = target.id
  render()
}

function addSiteToStack(siteId, stackId) {
  const site = sites.find((item) => item.id === siteId)
  const stack = stacks.find((item) => item.id === stackId)
  if (!site || !stack || stack.siteIds.includes(siteId)) return

  const previousStack = stacks.find((item) => item.id !== stack.id && item.siteIds.includes(siteId))
  if (previousStack) {
    previousStack.siteIds = previousStack.siteIds.filter((id) => id !== siteId)
    if (previousStack.siteIds.length <= 1) stacks = stacks.filter((item) => item.id !== previousStack.id)
  }

  site.group = stack.group
  stack.siteIds.push(siteId)
  state.openStack = stack.id
  state.selected = siteId
  render()
}

function removeSiteFromStack(siteId) {
  const stack = stacks.find((item) => item.siteIds.includes(siteId))
  if (!stack) return false

  stack.siteIds = stack.siteIds.filter((id) => id !== siteId)
  if (stack.siteIds.length <= 1) {
    stacks = stacks.filter((item) => item.id !== stack.id)
    if (state.openStack === stack.id) state.openStack = null
  }
  return true
}

function renderTimeline() {
  const entries = activity.toSorted((a, b) => b.at - a.at).map((entry) => ({ ...entry, site: sites.find((site) => site.id === entry.siteId) })).filter((entry) => entry.site)
  if (!entries.length) {
    timelineTrack.innerHTML = '<p class="timeline-empty">暂无浏览轨迹。收集并打开网页后，这里会按实际时间记录。</p>'
    return
  }
  timelineTrack.innerHTML = entries.map(({ site, at }) => `<button type="button" class="timeline-entry" data-timeline-site="${site.id}"><time>${new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time><span class="timeline-line" aria-hidden="true"></span><span class="timeline-entry-copy"><strong>${site.label}</strong><small>${site.host}</small><span class="timeline-sites"><i style="--tile-color:${site.color}">${siteMonogram(site)}</i></span></span></button>`).join('')
  timelineTrack.querySelectorAll('.timeline-entry').forEach((button) => button.addEventListener('click', () => {
    const site = sites.find((item) => item.id === button.dataset.timelineSite)
    if (!site) return
    state.selected = site.id
    state.activeGroup = site.group
    openDockView()
    render()
  }))
}

function renderUsageSummary() {
  const hasActivity = activity.length > 0
  weekMeter.hidden = !hasActivity
  if (!hasActivity) return
  const minutes = sites.reduce((sum, site) => sum + (site.minutes || 0), 0)
  document.querySelector('#week-browse').innerHTML = `${Math.floor(minutes / 60)}<span>h</span> ${minutes % 60}<span>m</span>`
  document.querySelector('#focus-time').innerHTML = `${Math.floor(minutes / 60)}<span>h ${minutes % 60}m</span>`
  document.querySelector('#focus-detail').textContent = minutes ? '来自已收集网页的实际停留时间' : '将在停留满 1 分钟后更新'
}

function applyInboxAction(action) {
  const selected = sites.find((site) => site.id === state.selected)
  if (!selected || selected.group !== 'inbox') return
  if (action === 'work') selected.group = 'work'
  if (action === 'later') selected.last = 7
  if (action === 'archive') removeSiteFromWorkspace(selected.id)
  if (action !== 'archive') state.selected = sites[0]?.id || null
  render()
}

function removeSiteFromWorkspace(siteId) {
  sites = sites.filter((site) => site.id !== siteId)
  stacks = stacks
    .map((stack) => ({ ...stack, siteIds: stack.siteIds.filter((id) => id !== siteId) }))
    .filter((stack) => stack.siteIds.length >= 2)
  activity = activity.filter((entry) => entry.siteId !== siteId)
  if (state.selected === siteId) state.selected = sites[0]?.id || null
  if (!stacks.some((stack) => stack.id === state.openStack)) state.openStack = null
}

function deleteSite(siteId) {
  const site = sites.find((item) => item.id === siteId)
  if (!site || !window.confirm(`删除“${site.label}”？这不会关闭已打开的网页。`)) return
  removeSiteFromWorkspace(siteId)
  render()
}

function openDockView() {
  state.view = 'dock'
  state.compact = false
}

function setEditMode(next) {
  state.editing = Boolean(next)
  render()
}

function render() {
  renderGroupNav()
  renderHeading()
  renderContinueWork()
  renderColumns()
  renderStackTray()
  renderInsights()
  renderUsageSummary()
  renderTimeline()
  document.querySelector('.dock-layout').hidden = state.view === 'timeline'
  timelineView.hidden = state.view !== 'timeline'
  scheduleWorkspaceSave()
}

function renderCommandResults(query = '') {
  const searchTerm = query.trim().toLowerCase()
  const matchingGroups = groups.filter((group) => group.title.toLowerCase().includes(searchTerm))
  const matchingSites = sites.filter((site) => `${site.label} ${site.host}`.toLowerCase().includes(searchTerm))
  const groupItems = matchingGroups.map((group) => `<button type="button" class="command-item" data-command-group="${group.id}"><span class="command-item-mark" style="--command-color:${group.color}">#</span><span class="command-item-copy"><strong>${group.title}</strong><small>${group.inbox ? '收件箱 · 待归类' : '任务空间'}</small></span></button>`).join('')
  const siteItems = matchingSites.map((site) => `<button type="button" class="command-item" data-command-site="${site.id}"><span class="command-item-mark" style="--command-color:${site.color}">${site.label.slice(0, 1)}</span><span class="command-item-copy"><strong>${site.label}</strong><small>${site.host}</small></span></button>`).join('')
  commandResults.innerHTML = groupItems || siteItems ? `${groupItems ? `<p class="command-section-label">任务空间</p>${groupItems}` : ''}${siteItems ? `<p class="command-section-label">网页</p>${siteItems}` : ''}` : '<p class="command-empty">没有匹配结果</p>'
  commandResults.querySelectorAll('[data-command-group]').forEach((button) => button.addEventListener('click', () => {
    state.activeGroup = button.dataset.commandGroup
    state.filter = 'all'
    commandDialog.close()
    render()
  }))
  commandResults.querySelectorAll('[data-command-site]').forEach((button) => button.addEventListener('click', () => {
    const site = sites.find((item) => item.id === button.dataset.commandSite)
    if (!site) return
    state.selected = site.id
    state.activeGroup = site.group
    state.filter = 'all'
    commandDialog.close()
    render()
  }))
}

function openCommand() {
  commandInput.value = ''
  renderCommandResults()
  commandDialog.showModal()
  commandInput.focus()
}

const backgroundImageKey = 'vista-workspace-background-v1'
const backgroundOpacityKey = 'vista-workspace-background-opacity-v1'
const backgroundNameKey = 'vista-workspace-background-name-v1'

function updateBackgroundPreview(image, name = '') {
  backgroundPreview.style.backgroundImage = image ? `url("${image}")` : ''
  backgroundPreview.classList.toggle('has-image', Boolean(image))
  backgroundPreviewLabel.textContent = image ? (name || '已设置图片') : '未设置图片'
}

function setBackgroundOpacity(value, persist = true) {
  const opacity = Math.max(18, Math.min(82, Number(value)))
  workspace.style.setProperty('--workspace-background-scrim', String((1 - opacity / 100).toFixed(2)))
  backgroundOpacity.value = opacity
  backgroundOpacityValue.textContent = `${opacity}%`
  if (persist) {
    try { localStorage.setItem(backgroundOpacityKey, String(opacity)) } catch { /* Keep the current visual setting when storage is unavailable. */ }
  }
}

function applyWorkspaceBackground(image, name = '', persist = true) {
  const hasImage = Boolean(image)
  if (hasImage) {
    backgroundImageElement.src = image
    backgroundImageElement.classList.add('is-visible')
    backgroundLayer.dataset.imageName = name
  } else {
    backgroundImageElement.removeAttribute('src')
    backgroundImageElement.classList.remove('is-visible')
    delete backgroundLayer.dataset.imageName
  }
  workspace.classList.toggle('has-workspace-background', hasImage)
  updateBackgroundPreview(image, name)
  if (!persist) return
  try {
    if (image) {
      localStorage.setItem(backgroundImageKey, image)
      localStorage.setItem(backgroundNameKey, name)
    } else {
      localStorage.removeItem(backgroundImageKey)
      localStorage.removeItem(backgroundNameKey)
    }
    backgroundStatus.textContent = image ? `已应用 ${name || '背景图片'}，并保存在本机浏览器中` : '已移除背景'
  } catch {
    backgroundStatus.textContent = image ? `已应用 ${name || '背景图片'}，仅在当前页面保留` : '已移除背景'
  }
}

function openBackgroundDialog() {
  backgroundStatus.textContent = workspace.classList.contains('has-workspace-background') ? '图片仅保存在本机浏览器中' : ''
  backgroundDialog.showModal()
}

function restoreWorkspaceBackground() {
  try {
    const savedImage = localStorage.getItem(backgroundImageKey)
    const savedOpacity = localStorage.getItem(backgroundOpacityKey)
    const savedName = localStorage.getItem(backgroundNameKey) || ''
    if (savedImage) applyWorkspaceBackground(savedImage, savedName, false)
    if (savedOpacity) setBackgroundOpacity(savedOpacity, false)
    else setBackgroundOpacity(backgroundOpacity.value, false)
  } catch { /* The workspace remains usable without local storage. */ }
}

function createFlowField(canvas) {
  const context = canvas.getContext('2d')
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const random = (() => {
    let seed = 57231
    return () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
  })()
  const pointer = { x: -999, y: -999, active: false }
  let frame = 0
  let enabled = !reduceMotion.matches
  let particles = []
  let dimensions = { width: 0, height: 0 }

  function createParticle() {
    const x = random() * dimensions.width
    const y = random() * dimensions.height
    return { x, y, phase: random() * Math.PI * 2, age: random() * 220, trail: Array.from({ length: 10 }, () => ({ x, y })) }
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect()
    const scale = Math.min(window.devicePixelRatio || 1, 2)
    dimensions = { width: bounds.width, height: bounds.height }
    canvas.width = Math.max(1, Math.floor(bounds.width * scale))
    canvas.height = Math.max(1, Math.floor(bounds.height * scale))
    context.setTransform(scale, 0, 0, scale, 0, 0)
    particles = Array.from({ length: Math.max(96, Math.min(156, Math.round(bounds.width / 7))) }, createParticle)
  }

  function fieldAngle(x, y, tick) {
    const xRatio = x / Math.max(dimensions.width, 1)
    const yRatio = y / Math.max(dimensions.height, 1)
    return Math.sin(xRatio * 7 + tick * .00028) * .8 + Math.cos(yRatio * 8 - tick * .00021) * .56 + Math.sin((xRatio + yRatio) * 5 + tick * .00013) * .24
  }

  function draw(tick) {
    if (!enabled || document.hidden || reduceMotion.matches) {
      frame = 0
      return
    }
    context.clearRect(0, 0, dimensions.width, dimensions.height)
    particles.forEach((particle) => {
      let angle = fieldAngle(particle.x, particle.y, tick) + particle.phase * .14
      if (pointer.active) {
        const dx = particle.x - pointer.x
        const dy = particle.y - pointer.y
        const distance = Math.hypot(dx, dy)
        if (distance < 145) angle += Math.atan2(dy, dx) * .09 * (1 - distance / 145)
      }
      const speed = 1.08 + Math.sin(tick * .001 + particle.phase) * .22
      particle.x += Math.cos(angle) * speed
      particle.y += Math.sin(angle) * speed
      particle.age += 1
      if (particle.x < -10 || particle.x > dimensions.width + 10 || particle.y < -10 || particle.y > dimensions.height + 10 || particle.age > 220) {
        Object.assign(particle, createParticle(), { age: 0 })
        return
      }
      particle.trail.push({ x: particle.x, y: particle.y })
      if (particle.trail.length > 10) particle.trail.shift()
      const alpha = .15 + (Math.sin(particle.age * .04 + particle.phase) + 1) * .055
      context.beginPath()
      context.moveTo(particle.trail[0].x, particle.trail[0].y)
      particle.trail.slice(1).forEach((point) => context.lineTo(point.x, point.y))
      context.strokeStyle = `rgba(52, 120, 246, ${alpha})`
      context.lineWidth = 1.25
      context.stroke()
      context.beginPath()
      context.arc(particle.x, particle.y, 1.55, 0, Math.PI * 2)
      context.fillStyle = `rgba(31, 95, 214, ${Math.min(alpha + .16, .46)})`
      context.fill()
    })
    frame = window.requestAnimationFrame(draw)
  }

  function setEnabled(next) {
    enabled = Boolean(next) && !reduceMotion.matches
    canvas.hidden = !enabled
    flowToggle.setAttribute('aria-pressed', String(enabled))
    flowToggle.textContent = enabled ? '流态背景' : '流态已关闭'
    if (enabled && !frame) frame = window.requestAnimationFrame(draw)
  }

  window.addEventListener('resize', resize)
  window.addEventListener('pointermove', (event) => {
    const bounds = canvas.getBoundingClientRect()
    pointer.x = event.clientX - bounds.left
    pointer.y = event.clientY - bounds.top
    pointer.active = pointer.x >= 0 && pointer.x <= dimensions.width && pointer.y >= 0 && pointer.y <= dimensions.height
  })
  document.addEventListener('visibilitychange', () => { if (!document.hidden && enabled && !frame) frame = window.requestAnimationFrame(draw) })
  reduceMotion.addEventListener('change', () => setEnabled(!reduceMotion.matches))
  resize()
  setEnabled(enabled)
  return setEnabled
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => { state.filter = button.dataset.filter; state.activeGroup = null; openDockView(); render() }))
function updateSearch(value) {
  state.search = value
  state.openStack = null
  renderHeading()
  renderColumns()
  renderStackTray()
}

searchInput.addEventListener('input', (event) => updateSearch(event.target.value))
searchInput.addEventListener('search', (event) => updateSearch(event.target.value))
document.querySelector('#toggle-edit').addEventListener('click', () => setEditMode(!state.editing))
document.querySelector('#continue-open').addEventListener('click', () => {
  const latest = activity.toSorted((a, b) => b.at - a.at)[0]
  const site = sites.find((item) => item.id === latest?.siteId)
  if (!site) return
  state.activeGroup = site.group
  state.selected = site.id
  openDockView()
  render()
})
document.querySelector('#open-command').addEventListener('click', openCommand)
commandInput.addEventListener('input', (event) => renderCommandResults(event.target.value))
commandInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  commandResults.querySelector('.command-item')?.click()
})
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (!commandDialog.open) openCommand()
  }
  if (event.key === 'Escape') {
    ;[commandDialog, backgroundDialog, dialog, groupDialog, workspaceNameDialog].forEach((modal) => {
      if (modal.open) modal.close()
    })
    if (state.editing) setEditMode(false)
  }
})
document.querySelector('#open-background').addEventListener('click', openBackgroundDialog)
document.querySelector('#close-background-dialog').addEventListener('click', () => backgroundDialog.close())
document.querySelector('#done-background').addEventListener('click', () => backgroundDialog.close())
document.querySelector('#clear-background').addEventListener('click', () => {
  backgroundFile.value = ''
  applyWorkspaceBackground('')
})
backgroundOpacity.addEventListener('input', (event) => setBackgroundOpacity(event.target.value))
backgroundFile.addEventListener('change', (event) => {
  const [file] = event.target.files
  if (!file) return
  if (!file.type.startsWith('image/')) {
    backgroundStatus.textContent = '请选择 PNG、JPEG 或 WebP 图片'
    return
  }
  if (file.size > 3 * 1024 * 1024) {
    backgroundStatus.textContent = '图片需小于 3 MB'
    return
  }
  const reader = new FileReader()
  reader.addEventListener('load', () => {
    const image = new Image()
    image.addEventListener('load', () => applyWorkspaceBackground(String(reader.result), file.name))
    image.addEventListener('error', () => { backgroundStatus.textContent = '图片无法解码，请更换后重试' })
    image.src = String(reader.result)
  })
  reader.addEventListener('error', () => { backgroundStatus.textContent = '读取图片失败，请重试' })
  reader.readAsDataURL(file)
})
const setFlowEnabled = createFlowField(flowCanvas)
flowToggle.addEventListener('click', () => setFlowEnabled(flowToggle.getAttribute('aria-pressed') !== 'true'))
document.querySelector('#show-quiet').addEventListener('click', () => { state.filter = 'quiet'; state.activeGroup = null; render() })
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('is-selected', item === tab))
  state.view = tab.dataset.view
  state.compact = state.view === 'focus'
  render()
}))

function fillGroupSelect() {
  const select = document.querySelector('#group-select')
  select.innerHTML = groups.map((group) => `<option value="${group.id}">${group.title}${group.inbox ? '（收件箱）' : ''}</option>`).join('')
  select.value = 'inbox'
}
function openDialog(site = null) {
  const form = document.querySelector('#site-form')
  const submit = form.querySelector('[type="submit"]')
  fillGroupSelect()
  editingSiteId = site?.id || null
  document.querySelector('#dialog-title').textContent = site ? '编辑网页' : '把网页放进 Dock'
  submit.innerHTML = site ? '保存修改' : '添加网页 <span>+</span>'
  form.reset()
  fillGroupSelect()
  if (site) {
    form.elements.label.value = site.label
    form.elements.host.value = site.url || site.host
    form.elements.group.value = site.group
  }
  dialog.showModal()
  form.elements.label.focus()
}
document.querySelector('#open-add').addEventListener('click', openDialog)
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close())
document.querySelector('#cancel-dialog').addEventListener('click', () => dialog.close())
function openGroupDialog() { groupDialog.showModal(); groupDialog.querySelector('input').focus() }
document.querySelector('#add-group').addEventListener('click', openGroupDialog)
document.querySelector('#close-group-dialog').addEventListener('click', () => groupDialog.close())
document.querySelector('#cancel-group-dialog').addEventListener('click', () => groupDialog.close())
function openWorkspaceNameDialog() {
  const input = workspaceNameDialog.querySelector('[name="workspaceName"]')
  input.value = workspaceName
  workspaceNameDialog.showModal()
  input.select()
}
document.querySelector('#edit-workspace-name').addEventListener('click', openWorkspaceNameDialog)
document.querySelector('#close-workspace-name-dialog').addEventListener('click', () => workspaceNameDialog.close())
document.querySelector('#cancel-workspace-name-dialog').addEventListener('click', () => workspaceNameDialog.close())
document.querySelector('#workspace-name-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const nextName = String(new FormData(event.currentTarget).get('workspaceName') || '').trim().slice(0, 32)
  if (!nextName) return
  workspaceName = nextName
  workspaceNameDialog.close()
  render()
})
document.querySelector('#group-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const data = new FormData(event.currentTarget)
  const group = { id: `group-${Date.now()}`, title: String(data.get('title')).trim(), color: String(data.get('color')) }
  if (!group.title) return
  groups.push(group)
  state.activeGroup = group.id
  state.filter = 'all'
  event.currentTarget.reset()
  groupDialog.close()
  render()
})
function siteLocation(value) {
  const entered = String(value || '').trim()
  if (!entered) return null
  try {
    const parsed = new URL(/^https?:\/\//i.test(entered) ? entered : `https://${entered}`)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    return { host: parsed.hostname.replace(/^www\./, ''), url: parsed.href }
  } catch {
    return null
  }
}

document.querySelector('#site-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const data = new FormData(event.currentTarget)
  const location = siteLocation(data.get('host'))
  const label = String(data.get('label')).trim()
  if (!location || !label) return

  const existing = sites.find((site) => site.id === editingSiteId)
  if (existing) {
    Object.assign(existing, { label, host: location.host, url: location.url, group: String(data.get('group')) })
    state.selected = existing.id
  } else {
    const site = { id: `site-${Date.now()}`, label, host: location.host, url: location.url, group: String(data.get('group')), count: 0, minutes: 0, last: 999, color: colorForHost(location.host) }
    sites.push(site)
    state.selected = site.id
  }
  editingSiteId = null
  event.currentTarget.reset()
  dialog.close()
  render()
})

function initializeExtensionUi() {
  const importButton = document.querySelector('#import-bookmarks')
  if (!isExtension) return

  importButton.hidden = !canImportBookmarks
  document.querySelector('.sidebar-foot').lastChild.textContent = '已保存在浏览器本地'
  if (canImportBookmarks) {
    importButton.addEventListener('click', async () => {
      importButton.disabled = true
      importButton.textContent = '正在导入...'
      try {
        const count = await importBrowserBookmarks()
        importButton.textContent = count ? `已导入 ${count} 个` : '没有新的书签'
        render()
      } catch {
        importButton.textContent = '导入失败'
      } finally {
        window.setTimeout(() => {
          importButton.disabled = false
          importButton.textContent = '导入书签'
        }, 1800)
      }
    })
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    const incoming = changes[workspaceStorageKey]?.newValue
    if (area !== 'local' || !validWorkspace(incoming)) return
    const normalized = normalizeWorkspace(incoming)
    const payload = JSON.stringify(normalized)
    if (payload === lastWorkspacePayload) return
    groups = normalized.groups
    sites = normalized.sites
    stacks = normalized.stacks
    activity = normalized.activity
    workspaceName = normalized.name
    lastWorkspacePayload = payload
    render()
  })
}

async function boot() {
  restoreWorkspaceBackground()
  await restoreWorkspace()
  initializeExtensionUi()
  render()
}

boot()
