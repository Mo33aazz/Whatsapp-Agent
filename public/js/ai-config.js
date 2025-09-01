;(function () {
  const AppConfig = {
    async loadConfiguration(d) {
      try {
        const response = await fetch('/config')
        if (response.ok) {
          const payload = await response.json()
          const config = payload && payload.config ? payload.config : payload
          AppConfig.populateConfigForm(d, config)
        }
      } catch (error) {
        console.error('Error loading configuration:', error)
        AppUtils.showToast('Failed to load configuration', 'error')
      }
    },

    populateConfigForm(d, config) {
      const elements = {
        apiKey: config.openrouterApiKey || '',
        aiModel: config.aiModel || 'openai/gpt-4o-mini',
        systemPrompt: config.systemPrompt || 'You are a helpful AI assistant for WhatsApp. Be concise and friendly.',
        wahaUrl: config.wahaUrl || 'http://localhost:3000',
        sessionName: config.sessionName || 'default'
      }
      Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id)
        if (!element) return
        if (id === 'apiKey') {
          const isMasked = value === '***configured***'
          if (isMasked) {
            element.value = ''
            element.placeholder = 'Leave empty to keep existing key'
            element.removeAttribute('required')
          } else {
            element.value = value || ''
            element.setAttribute('required', 'required')
          }
          if (element.value) AppConfig.validateAPIKey(d, element)
        } else {
          element.value = value
          if (id === 'aiModel') {
            AppConfig.validateAIModel(d, element)
            AppConfig.loadModelList(d)
          } else if (id === 'systemPrompt') {
            AppConfig.validateSystemPrompt(d, element)
          }
        }
      })
    },

    async handleConfigSubmit(d, e) {
      e.preventDefault()
      if (!AppConfig.validateForm(d)) {
        AppUtils.showToast('Please fix validation errors before submitting', 'error')
        return
      }
      const submitBtn = document.getElementById('saveConfigBtn')
      const formData = new FormData(e.target)
      const apiKey = (formData.get('apiKey') || '').trim()
      const config = {
        aiModel: formData.get('aiModel'),
        systemPrompt: formData.get('systemPrompt'),
        wahaUrl: formData.get('wahaUrl'),
        sessionName: formData.get('sessionName')
      }
      if (apiKey) config.openrouterApiKey = apiKey

      if (apiKey) {
        AppUtils.setButtonLoading(submitBtn, true, 'Validating...')
        AppUtils.showFormStatus('Validating API key...', 'info')
        try {
          const testResp = await fetch('/config/test-openrouter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ openrouterApiKey: apiKey })
          })
          const testResult = await testResp.json().catch(() => ({}))
          if (!testResp.ok || !testResult.success) {
            const msg = testResult && testResult.message ? testResult.message : 'API validation failed'
            AppUtils.setButtonLoading(submitBtn, false, 'Save Configuration')
            AppUtils.showToast(`Validation failed: ${msg}`, 'error')
            AppUtils.showFormStatus(`Validation failed: ${msg}`, 'error')
            return
          }
        } catch (err) {
          AppUtils.setButtonLoading(submitBtn, false, 'Save Configuration')
          AppUtils.showToast('Failed to validate API key', 'error')
          AppUtils.showFormStatus('Validation request failed', 'error')
          return
        }
      }

      try {
        AppUtils.setButtonLoading(submitBtn, true, 'Saving...')
        AppUtils.showFormStatus('Saving configuration...', 'info')
        const saveResp = await fetch('/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        })
        const result = await saveResp.json().catch(() => ({}))
        if (saveResp.ok && result.success !== false) {
          AppUtils.showToast('Configuration saved successfully!', 'success')
          AppUtils.showFormStatus('Configuration saved successfully!', 'success')
          AppUtils.setButtonState(submitBtn, 'success', 'Saved!')
          d.isEditingConfig = false
          d.loadStatus()
          setTimeout(() => {
            AppUtils.setButtonLoading(submitBtn, false, 'Save Configuration')
            AppUtils.hideFormStatus()
          }, 800)
        } else {
          const error = result && result.message ? result : { message: 'Save failed' }
          AppUtils.showToast(`Failed to save configuration: ${error.message}`, 'error')
          AppUtils.showFormStatus(`Error: ${error.message}`, 'error')
          AppUtils.setButtonState(submitBtn, 'error', 'Save Failed')
          setTimeout(() => AppUtils.setButtonLoading(submitBtn, false, 'Save Configuration'), 3000)
        }
      } catch (error) {
        console.error('Error validating/saving configuration:', error)
        AppUtils.showToast('Failed to validate or save configuration', 'error')
        AppUtils.showFormStatus('Network error occurred', 'error')
        AppUtils.setButtonState(submitBtn, 'error', 'Network Error')
        setTimeout(() => AppUtils.setButtonLoading(submitBtn, false, 'Save Configuration'), 3000)
      }
    },

    setupFormValidation(d) {
      const apiKeyInput = document.getElementById('apiKey')
      if (apiKeyInput) {
        apiKeyInput.addEventListener('input', (e) => {
          AppConfig.validateAPIKey(d, e.target)
          if (!d._debounceModels) d._debounceModels = d.debounce((val) => d.loadModelList(val), 600)
          const val = (e.target.value || '').trim()
          if (val) d._debounceModels(val)
        })
        apiKeyInput.addEventListener('blur', (e) => AppConfig.validateAPIKey(d, e.target))
      }

      const aiModelInput = document.getElementById('aiModel')
      if (aiModelInput) {
        aiModelInput.addEventListener('input', (e) => {
          AppConfig.validateAIModel(d, e.target)
          if (!d._debounceModels) d._debounceModels = d.debounce((val) => d.loadModelList(val), 600)
          const apiKeyVal = (document.getElementById('apiKey')?.value || '').trim()
          if (apiKeyVal) d._debounceModels(apiKeyVal)
        })
        aiModelInput.addEventListener('blur', (e) => AppConfig.validateAIModel(d, e.target))
      }

      const systemPromptTextarea = document.getElementById('systemPrompt')
      if (systemPromptTextarea) {
        systemPromptTextarea.addEventListener('input', (e) => AppConfig.validateSystemPrompt(d, e.target))
        systemPromptTextarea.addEventListener('blur', (e) => AppConfig.validateSystemPrompt(d, e.target))
      }
    },

    setupAPIKeyToggle(d) {
      const toggleBtn = document.getElementById('toggleApiKey')
      const apiKeyInput = document.getElementById('apiKey')
      if (toggleBtn && apiKeyInput) {
        toggleBtn.addEventListener('click', () => {
          const isPassword = apiKeyInput.type === 'password'
          apiKeyInput.type = isPassword ? 'text' : 'password'
          toggleBtn.innerHTML = isPassword ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>'
        })
      }
    },

    async loadModelList(d, apiKeyOverride = '') {
      try {
        const url = apiKeyOverride ? `/openrouter/models?apiKey=${encodeURIComponent(apiKeyOverride)}` : '/openrouter/models'
        const resp = await fetch(url)
        const data = await resp.json().catch(() => ({}))
        if (!resp.ok || !data.success) return
        const list = Array.isArray(data.models) ? data.models : []
        d._models = list
        const input = document.getElementById('aiModel')
        if (input && document.activeElement === input) {
          AppConfig.renderModelMenu(d, input.value)
        }
      } catch (_) {}
    },

    setupModelCombobox(d) {
      const input = document.getElementById('aiModel')
      const menu = document.getElementById('aiModelMenu')
      if (!input || !menu) return
      input.addEventListener('focus', () => {
        AppConfig.renderModelMenu(d, input.value)
        AppConfig.showModelMenu(d)
      })
      input.addEventListener('input', () => {
        AppConfig.renderModelMenu(d, input.value)
        AppConfig.showModelMenu(d)
      })
      input.addEventListener('keydown', (e) => {
        if (!d._models || !d._models.length) return
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault(); AppConfig.moveActive(d, 1); break
          case 'ArrowUp':
            e.preventDefault(); AppConfig.moveActive(d, -1); break
          case 'Enter':
            if (d._modelMenuState.open) { e.preventDefault(); AppConfig.selectActive(d) }
            break
          case 'Escape':
            AppConfig.hideModelMenu(d); break
        }
      })
      input.addEventListener('blur', () => setTimeout(() => AppConfig.hideModelMenu(d), 120))
      menu.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.combo-item')
        if (!item) return
        e.preventDefault()
        input.value = item.dataset.value || ''
        AppConfig.validateAIModel(d, input)
        AppConfig.hideModelMenu(d)
      })
    },

    filterModels(d, query) {
      const q = (query || '').toLowerCase().trim()
      const list = Array.isArray(d._models) ? d._models : []
      if (!q) return list.slice(0, 20)
      return list.filter((id) => id.toLowerCase().includes(q)).slice(0, 20)
    },

    renderModelMenu(d, query) {
      const menu = document.getElementById('aiModelMenu')
      const input = document.getElementById('aiModel')
      if (!menu || !input) return
      const matches = AppConfig.filterModels(d, query)
      menu.innerHTML = ''
      d._modelMenuState.activeIndex = -1
      if (!matches.length) {
        const empty = document.createElement('div')
        empty.className = 'combo-empty'
        empty.textContent = 'No models found'
        menu.appendChild(empty)
        return
      }
      matches.forEach((id, idx) => {
        const div = document.createElement('div')
        div.className = 'combo-item'
        div.setAttribute('role', 'option')
        div.dataset.value = id
        const parts = id.split('/')
        const provider = parts[0] || ''
        const model = parts.slice(1).join('/') || ''
        div.innerHTML = `<span class=\"provider\">${provider}</span>${model ? '/' : ''}<span class=\"model\">${model}</span>`
        if (idx === 0) div.classList.add('active')
        menu.appendChild(div)
      })
      d._modelMenuState.activeIndex = matches.length ? 0 : -1
      input.setAttribute('aria-expanded', 'true')
    },

    showModelMenu(d) {
      const menu = document.getElementById('aiModelMenu')
      const input = document.getElementById('aiModel')
      if (!menu || !input) return
      menu.hidden = false
      d._modelMenuState.open = true
      input.setAttribute('aria-expanded', 'true')
    },

    hideModelMenu(d) {
      const menu = document.getElementById('aiModelMenu')
      const input = document.getElementById('aiModel')
      if (!menu || !input) return
      menu.hidden = true
      d._modelMenuState.open = false
      d._modelMenuState.activeIndex = -1
      input.setAttribute('aria-expanded', 'false')
    },

    moveActive(d, delta) {
      const menu = document.getElementById('aiModelMenu')
      if (!menu || menu.hidden) return
      const items = Array.from(menu.querySelectorAll('.combo-item'))
      if (!items.length) return
      let idx = d._modelMenuState.activeIndex
      idx = (idx + delta + items.length) % items.length
      items.forEach((el) => el.classList.remove('active'))
      items[idx].classList.add('active')
      d._modelMenuState.activeIndex = idx
      const active = items[idx]
      const mRect = menu.getBoundingClientRect()
      const aRect = active.getBoundingClientRect()
      if (aRect.bottom > mRect.bottom) menu.scrollTop += aRect.bottom - mRect.bottom
      if (aRect.top < mRect.top) menu.scrollTop -= mRect.top - aRect.top
    },

    selectActive(d) {
      const menu = document.getElementById('aiModelMenu')
      const input = document.getElementById('aiModel')
      if (!menu || !input) return
      const items = Array.from(menu.querySelectorAll('.combo-item'))
      if (!items.length) return
      const idx = d._modelMenuState.activeIndex >= 0 ? d._modelMenuState.activeIndex : 0
      const val = items[idx].dataset.value || ''
      input.value = val
      AppConfig.validateAIModel(d, input)
      AppConfig.hideModelMenu(d)
    },

    validateAPIKey(d, input) {
      const value = input.value.trim()
      const wrapper = input.closest('.input-wrapper')
      const strengthIndicator = wrapper?.querySelector('.api-key-strength')
      let isValid = false
      let message = ''
      let strength = 'weak'
      if (!value) {
        if (!input.hasAttribute('required')) {
          isValid = true
          message = 'Using existing saved API key'
        } else {
          message = 'API key is required'
        }
      } else if (!value.startsWith('sk-or-v1-') && !value.startsWith('sk-')) {
        message = 'API key must start with "sk-or-v1-" or "sk-"'
      } else if (value.length < 20) {
        message = 'API key appears to be too short'
      } else {
        isValid = true
        message = 'Valid API key format'
        if (value.length >= 50) strength = 'strong'
        else if (value.length >= 30) strength = 'medium'
      }
      AppConfig.updateValidationState(d, input, isValid, message)
      AppConfig.updateAPIKeyStrength(d, strengthIndicator, strength, isValid)
      return isValid
    },

    validateAIModel(d, input) {
      const value = (input.value || '').trim()
      const isValid = value.length > 0
      const message = isValid ? 'Model set' : 'Enter a model ID (e.g., openai/gpt-4o-mini)'
      AppConfig.updateValidationState(d, input, isValid, message)
      return isValid
    },

    validateSystemPrompt(d, textarea) {
      const value = textarea.value.trim()
      const wrapper = textarea.closest('.form-group')
      const charCounter = wrapper?.querySelector('.char-counter')
      const isValid = value.length <= 500
      let message = ''
      if (value.length > 500) message = 'System prompt must be less than 500 characters'
      else message = value.length === 0 ? 'System prompt is optional' : 'Valid system prompt'
      if (charCounter) {
        charCounter.textContent = `${value.length}/500`
        charCounter.className = `char-counter ${value.length > 500 ? 'over-limit' : ''}`
      }
      AppConfig.updateValidationState(d, textarea, isValid, message)
      return isValid
    },

    updateValidationState(d, element, isValid, message) {
      const wrapper = element.closest('.input-wrapper') || element.closest('.form-group')
      const validationMsg = wrapper?.querySelector('.validation-message')
      const validationIcon = wrapper?.querySelector('.validation-icon')
      element.classList.remove('valid', 'invalid')
      element.classList.add(isValid ? 'valid' : 'invalid')
      if (validationMsg) {
        validationMsg.textContent = message
        validationMsg.className = `validation-message ${isValid ? 'success' : 'error'}`
      }
      if (validationIcon) {
        validationIcon.innerHTML = isValid ? '<i class="fas fa-check"></i>' : '<i class="fas fa-times"></i>'
        validationIcon.className = `validation-icon ${isValid ? 'success' : 'error'}`
      }
    },

    updateAPIKeyStrength(d, indicator, strength, isValid) {
      if (!indicator) return
      indicator.className = `api-key-strength ${isValid ? strength : 'weak'}`
      const strengthText = indicator.querySelector('.strength-text')
      if (strengthText) strengthText.textContent = !isValid ? 'Invalid' : strength.charAt(0).toUpperCase() + strength.slice(1)
    },

    validateForm(d) {
      const apiKeyInput = document.getElementById('apiKey')
      const aiModelSelect = document.getElementById('aiModel')
      const systemPromptTextarea = document.getElementById('systemPrompt')
      const apiKeyValid = apiKeyInput.hasAttribute('required')
        ? AppConfig.validateAPIKey(d, apiKeyInput)
        : (apiKeyInput.value.trim() ? AppConfig.validateAPIKey(d, apiKeyInput) : true)
      const aiModelValid = AppConfig.validateAIModel(d, aiModelSelect)
      const systemPromptValid = AppConfig.validateSystemPrompt(d, systemPromptTextarea)
      return apiKeyValid && aiModelValid && systemPromptValid
    },

    clearForm(d) {
      if (!confirm('Are you sure you want to clear all form data?')) return
      const form = document.getElementById('configForm')
      if (!form) return
      form.reset()
      const inputs = form.querySelectorAll('input, select, textarea')
      inputs.forEach((input) => {
        input.classList.remove('valid', 'invalid')
        const wrapper = input.closest('.input-wrapper') || input.closest('.form-group')
        const validationMsg = wrapper?.querySelector('.validation-message')
        const validationIcon = wrapper?.querySelector('.validation-icon')
        if (validationMsg) validationMsg.textContent = ''
        if (validationIcon) validationIcon.innerHTML = ''
      })
      const strengthIndicator = document.querySelector('.api-key-strength')
      if (strengthIndicator) {
        strengthIndicator.className = 'api-key-strength weak'
        const strengthText = strengthIndicator.querySelector('.strength-text')
        if (strengthText) strengthText.textContent = 'Weak'
      }
      const charCounter = document.querySelector('.char-counter')
      if (charCounter) {
        charCounter.textContent = '0/500'
        charCounter.className = 'char-counter'
      }
      AppUtils.hideFormStatus()
      AppUtils.showToast('Form cleared', 'info')
    },

    async testOpenRouterAPI(d) {
      const testAPIBtn = document.getElementById('testAPI')
      if (testAPIBtn) {
        testAPIBtn.disabled = true
        testAPIBtn.textContent = 'Testing...'
      }
      try {
        const response = await fetch('/config/test-openrouter', { method: 'POST' })
        const result = await response.json()
        if (response.ok && result.success) {
          AppUtils.showToast('OpenRouter API test successful!', 'success')
        } else {
          AppUtils.showToast(`API test failed: ${result.message}`, 'error')
        }
      } catch (error) {
        console.error('Error testing API:', error)
        AppUtils.showToast('Failed to test OpenRouter API', 'error')
      } finally {
        if (testAPIBtn) {
          testAPIBtn.disabled = false
          testAPIBtn.textContent = 'Test API'
        }
      }
    },

    async testConnection(d) {
      const testBtn = document.getElementById('testConnection')
      const apiKeyInput = document.getElementById('apiKey')
      if (!AppConfig.validateAPIKey(d, apiKeyInput)) {
        AppUtils.showToast('Please enter a valid API key first', 'warning')
        return
      }
      AppUtils.setButtonLoading(testBtn, true, 'Testing...')
      AppUtils.showFormStatus('Testing API connection...', 'info')
      try {
        const response = await fetch('/config/test-openrouter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openrouterApiKey: apiKeyInput.value })
        })
        const result = await response.json()
        if (response.ok && result.success) {
          AppUtils.showToast('API connection test successful!', 'success')
          AppUtils.showFormStatus('API connection verified!', 'success')
          AppUtils.setButtonState(testBtn, 'success', 'Connected!')
        } else {
          AppUtils.showToast(`API test failed: ${result.message}`, 'error')
          AppUtils.showFormStatus(`Test failed: ${result.message}`, 'error')
          AppUtils.setButtonState(testBtn, 'error', 'Test Failed')
        }
      } catch (error) {
        console.error('Error testing connection:', error)
        AppUtils.showToast('Failed to test API connection', 'error')
        AppUtils.showFormStatus('Connection test failed', 'error')
        AppUtils.setButtonState(testBtn, 'error', 'Test Failed')
      } finally {
        setTimeout(() => {
          AppUtils.setButtonLoading(testBtn, false, 'Test Connection')
          AppUtils.hideFormStatus()
        }, 3000)
      }
    }
  }

  window.AppConfig = AppConfig
})()

