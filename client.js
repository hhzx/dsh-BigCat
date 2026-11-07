/**
 * dsh-BigCat — browser half.
 *
 * Click a sent user message to edit it and send again from that point.
 * The pin at the top-right toggles whether DSH Desktop stays above other windows.
 *
 * @module dsh-BigCat/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-BigCat',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports

    const css = [
      '.bc_pin{position:fixed;z-index:80;top:7px;right:168px;width:32px;height:28px;border-radius:8px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#8d8d8d);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;-webkit-app-region:no-drag;app-region:no-drag}',
      '.bc_pin svg{-webkit-app-region:no-drag;app-region:no-drag;pointer-events:none;transform-origin:50% 50%}',
      '.bc_pin:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#fff)}',
      '.bc_pin[data-on=false] svg{transform:rotate(-42deg)}',
      '.bc_pin[data-on=true]{color:#3fb950}',
      '.bc_pin[data-on=true] svg{transform:none}',
      '.bc_pin[data-busy=true]{opacity:.55;pointer-events:none}',
      '[data-chat-flow-kind="user"] [class*="_bubble"]{cursor:text}',
      '[data-chat-flow-kind="user"] [class*="_bubble"][data-bc-editing]{box-sizing:border-box;display:flex;flex-direction:column;align-items:stretch;gap:8px;padding:8px 16px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,rgba(255,255,255,.18));background:var(--dsw-specific-bubble)}',
      '[data-chat-flow-kind="user"]:has([data-bc-editing]) [class*="_actions"]{opacity:1!important}',
      '[data-chat-flow-kind="user"]:has([data-bc-editing]) [class*="_actions"]>button{display:none}',
      '[data-bc-hidden]{display:none!important}',
      '.bc_inline{display:flex;flex-direction:column;gap:8px;width:100%;margin:0}',
      '.bc_area{width:100%;max-height:240px;box-sizing:border-box;margin:0;padding:0;border:0;outline:0;resize:none;overflow:hidden;background:transparent;color:inherit;caret-color:var(--dsw-alias-label-primary,#fff);font:inherit;line-height:inherit;white-space:pre-wrap}',
      '.bc_bar{display:flex;align-items:center;justify-content:flex-end;gap:6px;min-height:28px}',
      '.bc_err{margin-right:auto;font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary,#e5484d)}',
      '.bc_cancel{height:26px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#bdbdbd);font:inherit;font-size:13px;cursor:pointer}',
      '.bc_cancel:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#fff)}',
      '.bc_send{width:26px;height:26px;border:0;border-radius:999px;padding:0;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-label-primary,#f2f2f2);color:var(--dsw-alias-bg-base,#141414);cursor:pointer}',
      '.bc_send:hover{filter:brightness(1.06)}',
      '.bc_send:disabled{opacity:.4;cursor:default}',
    ].join('\n')

    function norm(text) {
      return String(text ?? '').replace(/\s+/g, ' ').trim()
    }

    function mainSessionId(sessions) {
      const state = sessions?.list?.getSnapshot?.()
      if (!state?.byId) return null
      const hit = Object.values(state.byId).find((row) => (row?.retainedBy?.mainView ?? 0) > 0)
      return hit?.id ?? null
    }

    async function api(path, body) {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`)
      return payload
    }

    function failureOf(result) {
      if (result && result.ok === false) return result.error?.message || result.error?.code || '发送失败'
      return null
    }

    async function resend(rootCtx, sessionId, edited, cut) {
      const sessions = rootCtx.get?.('sessions')
      const workspace = rootCtx.get?.('uiWorkspace')
      if (!sessions?.fork || !sessions?.using) throw new Error('会话接口不可用')
      let childId
      if (typeof cut.prevSeq === 'number') {
        childId = await sessions.fork({ sessionId, atSeq: cut.prevSeq, increaseTitle: true })
      } else if (sessions.create) {
        childId = await sessions.create(cut.cwd ? { cwd: cut.cwd } : {})
      } else {
        throw new Error('这条消息前面没有可分叉的位置')
      }
      workspace?.openSession?.(childId)
      await sessions.using(childId, { source: 'controllerOperation' }, async (reference) => {
        const session = (await reference.ready).session
        let requestId
        if (typeof session.beginSubmission === 'function') {
          requestId = session.beginSubmission({ mode: 'queue', text: edited, attachments: [] }).requestId
        }
        const result = await session.prompt([{ type: 'text', text: edited }], 'queue', undefined, requestId)
        const failure = failureOf(result)
        if (failure) throw new Error(failure)
      })
    }

    function apply(ctx) {
      const rootCtx = ctx
      const style = document.createElement('style')
      style.textContent = css
      document.head.appendChild(style)

      const pin = document.createElement('button')
      pin.type = 'button'
      pin.className = 'bc_pin'
      const pinOff = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" d="M8.5 3.5h7v5.2l2.2 2.1V13H6.3v-2.2l2.2-2.1V3.5z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 13v7.5"/></svg>'
      const pinOn = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/></svg>'
      document.querySelectorAll('.bc_pin').forEach((node) => node.remove())
      document.body.appendChild(pin)

      const placePin = () => {
        const overlay = navigator.windowControlsOverlay
        let rect = null
        try {
          if (overlay && overlay.visible !== false && typeof overlay.getTitlebarAreaRect === 'function') rect = overlay.getTitlebarAreaRect()
        } catch { rect = null }
        if (rect && rect.width > 80 && rect.height > 0) {
          const height = 28
          const width = 32
          pin.style.top = `${Math.round(rect.y + (rect.height - height) / 2)}px`
          pin.style.left = `${Math.round(rect.x + rect.width - width - 16)}px`
          pin.style.right = 'auto'
          return
        }
        pin.style.top = '7px'
        pin.style.left = 'auto'
        pin.style.right = '168px'
      }
      placePin()
      navigator.windowControlsOverlay?.addEventListener?.('geometrychange', placePin)
      window.addEventListener('resize', placePin)

      let pinned = false
      let stamp = 0
      const paintPin = () => {
        pin.dataset.on = pinned ? 'true' : 'false'
        pin.setAttribute('aria-pressed', pinned ? 'true' : 'false')
        pin.title = pinned ? '取消置顶' : '钉在最前'
        pin.setAttribute('aria-label', pin.title)
        pin.innerHTML = pinned ? pinOn : pinOff
      }
      const showPin = (on) => {
        pinned = on === true
        paintPin()
      }
      showPin(false)
      const first = ++stamp
      api('/api/bigcat/pin').then((payload) => { if (first === stamp) showPin(payload.on) }).catch(() => {})
      pin.addEventListener('click', async (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (pin.dataset.busy) return
        const ticket = ++stamp
        const next = !pinned
        showPin(next)
        pin.dataset.busy = 'true'
        try {
          const payload = await api('/api/bigcat/pin', { on: next })
          if (ticket === stamp) showPin(payload.on)
        } catch (error) {
          if (ticket === stamp) {
            showPin(!next)
            pin.title = String(error?.message ?? error)
          }
        } finally {
          if (ticket === stamp) delete pin.dataset.busy
        }
      })

      let editor = null
      const closeEditor = () => {
        if (!editor) return
        editor.form.remove()
        for (const child of editor.hidden) delete child.dataset.bcHidden
        delete editor.bubble.dataset.bcEditing
        editor.bubble.style.width = ''
        editor.bubble.style.maxWidth = ''
        editor.bubble.style.boxSizing = ''
        editor = null
      }

      const bubbleIn = (target) => {
        const flow = target.closest?.('[data-chat-flow-kind="user"]')
        const bubble = target.closest?.('[class*="_bubble"]')
        if (!flow || !bubble || !flow.contains(bubble)) return null
        return { flow, bubble }
      }

      const fit = (area) => {
        area.style.height = 'auto'
        const next = Math.min(area.scrollHeight, 240)
        area.style.height = `${next}px`
        area.style.overflowY = area.scrollHeight > 240 ? 'auto' : 'hidden'
      }

      const openEditor = (flow, bubble) => {
        if (editor?.bubble === bubble) return
        closeEditor()
        const text = bubble.innerText.replace(/\u00a0/g, ' ').trim()
        if (!text) return
        const locked = bubble.getBoundingClientRect().width
        bubble.style.boxSizing = 'border-box'
        bubble.style.width = `${locked}px`
        bubble.style.maxWidth = `${locked}px`
        const bubbles = [...document.querySelectorAll('[data-chat-flow-kind="user"] [class*="_bubble"]')]
        const nth = bubbles.filter((item) => norm(item.innerText) === norm(text)).indexOf(bubble)
        const hidden = [...bubble.children]
        for (const child of hidden) child.dataset.bcHidden = '1'
        bubble.dataset.bcEditing = 'true'
        const form = document.createElement('form')
        form.className = 'bc_inline'
        form.innerHTML = '<textarea class="bc_area" rows="1"></textarea><div class="bc_bar"><span class="bc_err" hidden></span><button type="button" class="bc_cancel">取消</button><button type="submit" class="bc_send" aria-label="发送"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg></button></div>'
        bubble.appendChild(form)
        const area = form.querySelector('textarea')
        area.value = text
        fit(area)
        area.addEventListener('input', () => fit(area))
        area.addEventListener('keydown', (keyEvent) => {
          if (keyEvent.key === 'Enter' && !keyEvent.shiftKey && !keyEvent.isComposing) {
            keyEvent.preventDefault()
            form.requestSubmit()
          }
        })
        area.focus()
        area.setSelectionRange(text.length, text.length)
        editor = { form, bubble, hidden, text, nth }
        form.querySelector('.bc_cancel').addEventListener('click', (click) => {
          click.preventDefault()
          click.stopPropagation()
          closeEditor()
        })
        form.addEventListener('submit', async (submitEvent) => {
          submitEvent.preventDefault()
          submitEvent.stopPropagation()
          const edited = area.value.trim()
          const errorNode = form.querySelector('.bc_err')
          if (!edited) { errorNode.hidden = false; errorNode.textContent = '内容是空的'; return }
          const sessionId = mainSessionId(rootCtx.get?.('sessions'))
          if (!sessionId) { errorNode.hidden = false; errorNode.textContent = '没有打开的会话'; return }
          const button = form.querySelector('.bc_send')
          button.disabled = true
          try {
            const cut = await api('/api/bigcat/locate', { sessionId, text: editor.text, nth: editor.nth })
            await resend(rootCtx, sessionId, edited, cut)
            closeEditor()
          } catch (error) {
            button.disabled = false
            errorNode.hidden = false
            errorNode.textContent = String(error?.message ?? error)
          }
        })
      }

      document.addEventListener('click', (event) => {
        if (pin.contains(event.target) || editor?.form.contains(event.target)) return
        const hit = bubbleIn(event.target)
        if (!hit) { closeEditor(); return }
        const selection = window.getSelection?.()
        if (selection && !selection.isCollapsed && hit.bubble.contains(selection.anchorNode)) return
        event.preventDefault()
        event.stopPropagation()
        openEditor(hit.flow, hit.bubble)
      }, true)
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && editor) {
          event.preventDefault()
          event.stopPropagation()
          closeEditor()
        }
      }, true)

      ctx.on?.('dispose', () => {
        navigator.windowControlsOverlay?.removeEventListener?.('geometrychange', placePin)
        window.removeEventListener('resize', placePin)
        style.remove()
        pin.remove()
        closeEditor()
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
