;(function () {
  const AppFeatures = {
    initFeatureCards(d) {
      const featureCards = document.querySelectorAll('.feature-card')
      featureCards.forEach((card, index) => {
        card.style.opacity = '0'
        card.style.transform = 'translateY(20px)'
        setTimeout(() => {
          card.style.transition = 'all 0.6s ease'
          card.style.opacity = '1'
          card.style.transform = 'translateY(0)'
        }, 100 + index * 150)
        card.addEventListener('mouseenter', () => {
          card.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        })
        card.addEventListener('click', () => {
          card.style.transform = 'scale(0.98)'
          setTimeout(() => { card.style.transform = '' }, 150)
          const title = card.querySelector('.feature-title')?.textContent || 'This feature'
          AppUtils.showToast(`${title} is coming soon! Stay tuned for updates.`, 'info')
        })
      })
    }
  }

  window.AppFeatures = AppFeatures
})()

