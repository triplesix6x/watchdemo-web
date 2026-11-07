import assert from 'node:assert/strict'

async function visible(locator) { await locator.first().waitFor({ state: 'visible' }) }
async function text(locator, expected) {
  await locator.page().waitForFunction(({ selector, expected }) => document.querySelector(selector)?.textContent === expected, { selector: `[data-testid="${await locator.getAttribute('data-testid')}"]`, expected })
}
export async function interact(page, c) {
  const main = page.locator('main')
  await visible(main)
  if (c.action === 'async-stale') {
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.getByRole('button', { name: 'Resolve latest' }).click()
    await text(page.getByTestId('value'), 'new')
    await page.getByRole('button', { name: 'Resolve initial' }).click()
    await text(page.getByTestId('value'), 'old') // B09: preserve observed source contract, do not fix latest-wins.
    return ['refresh resolves new; live initial completion overwrites with old (B09)']
  }
  if (c.action === 'loading') {
    await page.clock.runFor(1200)
    await visible(page.locator('.skeleton, .mini-loader, .logo-loader, .shell-wait'))
    return ['existing delayed mock response remains pending at 1200ms']
  }
  await page.clock.runFor(3500)
  if (c.action !== 'load-error') await visible(main.locator('h1'))
  if (c.id === 'home' || c.action === 'home-scroll') {
    await visible(page.locator('canvas'))
    assert.ok(await page.locator('canvas').count() > 0, 'Actual graphics canvases mounted')
    if (c.action === 'home-scroll') {
      await page.mouse.wheel(0, 700)
      await page.clock.runFor(500)
    }
    return ['whole-home root and actual graphics canvases mounted; initial or scroll state']
  }
  if (c.action === 'route-history') {
    const prefix = c.lang === 'en' ? '/en' : ''
    await main.locator(`a[href="${prefix}/register"]`).click()
    await page.clock.runFor(800)
    await page.waitForURL(new RegExp(`${prefix}/register$`))
    await page.goBack()
    await page.clock.runFor(800)
    await page.waitForURL(new RegExp(`${prefix}/login$`))
    await visible(page.locator('input[autocomplete="username"]'))
    await page.goForward()
    await page.clock.runFor(800)
    await page.waitForURL(new RegExp(`${prefix}/register$`))
    return ['actual localized SPA link, browser back and forward restore auth routes']
  }
  if (c.action.startsWith('login-')) {
    const form = page.locator('form.auth-form')
    const submit = form.locator('button[type="submit"]')
    if (c.action === 'login-validation') {
      await submit.click()
      assert.equal(await form.locator('[aria-invalid="true"]').count(), 2)
      return ['empty form submit marks both actual fields invalid']
    }
    await form.locator('input[autocomplete="username"]').fill('qa@example.invalid')
    await form.locator('input[autocomplete="current-password"]').fill(c.action === 'login-error' ? 'wrong' : 'CorrectPassword123')
    await submit.click()
    assert.ok(await submit.isDisabled(), 'Pending submit is locked')
    await page.clock.runFor(1500)
    if (c.action === 'login-error') await visible(form.locator('.note'))
    else {
      await page.waitForURL(/\/account$/)
      await visible(page.locator('.app-frame'))
    }
    return ['DOM field input; pending submit lock; existing mock wrong-password error or account redirect']
  }
  if (c.action === 'forgot-sent') {
    await page.locator('form input[type="email"]').fill('qa@example.invalid')
    await page.locator('form button[type="submit"]').click()
    await page.clock.runFor(1500)
    await page.locator('form.auth-form').waitFor({ state: 'detached' })
    assert.ok((await main.innerText()).includes('qa@example.invalid'))
    return ['neutral email-link sent state replaces form']
  }
  if (c.action === 'help-search') {
    const input = main.locator('input')
    await input.fill('__qa_no_match__')
    await visible(main.locator('.empty'))
    await input.fill('')
    await main.locator('.empty').waitFor({ state: 'detached' })
    return ['search produces existing empty state and restores FAQ on clear']
  }
  if (c.action === 'controls') {
    const open = page.getByRole('button', { name: 'Открыть диалог', exact: true })
    await open.click()
    await visible(page.getByRole('dialog'))
    assert.ok(await page.getByRole('dialog').evaluate(el => el.contains(document.activeElement)))
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.ok(await open.evaluate(el => el === document.activeElement), 'Dialog returns focus')
    const group = page.getByRole('radiogroup', { name: 'Список', exact: true })
    await group.getByRole('radio').first().focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await group.getByRole('radio').nth(1).getAttribute('aria-checked'), 'true')
    return ['production showcase Dialog Escape/focus return and Seg keyboard selection']
  }
  if (c.action === 'protected') {
    await page.waitForURL(/\/login/)
    assert.equal(await page.locator('.app-frame').count(), 0)
    return ['anonymous protected route redirects without app shell after restore']
  }
  if (c.action === 'token-error') {
    await visible(main.locator('.auth-lead'))
    await visible(main.locator('a[href$="/resend-verification"]'))
    assert.equal(await main.locator('.logo-loader').count(), 0)
    return ['existing bad/expired-token failure card and recovery link; not pending']
  }
  if (c.id === 'admin-empty') {
    await visible(main.locator('.empty'))
    return ['existing mock filter yields empty list']
  }
  if (c.action === 'load-error' || c.action === 'policy-error') {
    await visible(main.locator('.note, .empty, [role="alert"]'))
    return ['existing mock error visibly rendered']
  }
  return ['real route main heading rendered (representative mount only)']
}

export async function domRecord(page) {
  return page.locator('body').evaluate(body => ({
    text: body.innerText,
    url: location.pathname + location.search + location.hash,
    scroll: [scrollX, scrollY],
    elements: [...body.querySelectorAll('h1,h2,button,input,[role],canvas')].map(el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el)
      return { tag: el.tagName, role: el.getAttribute('role'), text: el.textContent, label: el.getAttribute('aria-label'), invalid: el.getAttribute('aria-invalid'), checked: el.getAttribute('aria-checked'), rect: [r.x, r.y, r.width, r.height], color: s.color, background: s.backgroundColor, font: s.font, transform: s.transform }
    }),
  }))
}
