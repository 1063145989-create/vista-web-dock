const title = document.querySelector('#page-title')
const host = document.querySelector('#page-host')
const status = document.querySelector('#status')
const collect = document.querySelector('#collect-page')

chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) => {
  title.textContent = tab?.title || '当前网页'
  try { host.textContent = new URL(tab?.url || '').hostname.replace(/^www\./, '') } catch { host.textContent = '' }
})

collect.addEventListener('click', () => {
  collect.disabled = true
  status.textContent = '正在收集...'
  chrome.runtime.sendMessage({ type: 'collect-current-page' }, (result) => {
    if (result?.ok) {
      status.textContent = `已收集：${result.label}`
      collect.textContent = '已在收件箱'
    } else {
      status.textContent = result?.error || '收集失败，请重试'
      collect.disabled = false
    }
  })
})

document.querySelector('#open-dock').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
})
