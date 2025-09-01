// Global utility helpers for the dashboard (no side effects)
;(function () {
  const AppUtils = {
    showToast(message, type = 'info') {
      const toastContainer = document.getElementById('toastContainer')
      if (!toastContainer) return
      const toast = document.createElement('div')
      toast.className = `toast ${type}`
      toast.textContent = message
      toastContainer.appendChild(toast)
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast)
      }, 5000)
    },

    setButtonLoading(button, loading, text) {
      if (!button) return
      if (loading) {
        button.disabled = true
        button.classList.add('loading')
        button.innerHTML = `<i class=\"fas fa-spinner fa-spin\"></i> ${text}`
      } else {
        button.disabled = false
        button.classList.remove('loading', 'success', 'error')
        button.innerHTML = text
      }
    },

    setButtonState(button, state, text) {
      if (!button) return
      button.classList.remove('loading', 'success', 'error')
      button.classList.add(state)
      const icon = state === 'success' ? 'check' : 'times'
      button.innerHTML = `<i class=\"fas fa-${icon}\"></i> ${text}`
    },

    showFormStatus(message, type) {
      const formStatus = document.getElementById('formStatus')
      if (!formStatus) return
      formStatus.textContent = message
      formStatus.className = `form-status ${type}`
      formStatus.style.display = 'block'
    },

    hideFormStatus() {
      const formStatus = document.getElementById('formStatus')
      if (formStatus) formStatus.style.display = 'none'
    },

    animateNumber(element, targetNumber) {
      const currentNumber = parseInt(element.textContent) || 0
      const difference = targetNumber - currentNumber
      const increment = Math.ceil(Math.abs(difference) / 20) || 1
      if (difference === 0) return
      let current = currentNumber
      const timer = setInterval(() => {
        if (difference > 0) {
          current += increment
          if (current >= targetNumber) {
            current = targetNumber
            clearInterval(timer)
          }
        } else {
          current -= increment
          if (current <= targetNumber) {
            current = targetNumber
            clearInterval(timer)
          }
        }
        element.textContent = current.toLocaleString()
      }, 50)
    },

    formatUptime(seconds) {
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      const secs = seconds % 60
      if (hours > 0) return `${hours}h ${minutes}m`
      if (minutes > 0) return `${minutes}m ${secs}s`
      return `${secs}s`
    },

    debounce(fn, wait = 300, ctx = null) {
      let t
      return (...args) => {
        clearTimeout(t)
        t = setTimeout(() => fn.apply(ctx || this, args), wait)
      }
    }
  }

  window.AppUtils = AppUtils
})()

