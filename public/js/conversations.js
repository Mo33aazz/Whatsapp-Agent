;(function () {
  const AppConversations = {
    async loadConversations(d) {
      const conversationsContainer = document.getElementById('conversationsContainer')
      if (!conversationsContainer) return
      try {
        const response = await fetch('/conversations')
        if (response.ok) {
          const data = await response.json()
          let conversations = data.conversations || data
          if (conversations && !Array.isArray(conversations) && typeof conversations === 'object') {
            conversations = Object.entries(conversations).map(([userId, conv]) => ({ userId, ...(conv || {}) }))
          }
          if (Array.isArray(conversations)) {
            conversations.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
          }
          AppConversations.displayConversations(d, Array.isArray(conversations) ? conversations : [])
        } else {
          conversationsContainer.innerHTML = '<div class="loading-placeholder">Failed to load conversations</div>'
        }
      } catch (error) {
        console.error('Error loading conversations:', error)
        conversationsContainer.innerHTML = '<div class="loading-placeholder">Error loading conversations</div>'
      }
    },

    displayConversations(d, conversations) {
      const conversationsContainer = document.getElementById('conversationsContainer')
      if (!conversationsContainer) return
      if (!conversations || conversations.length === 0) {
        conversationsContainer.innerHTML = '<div class="loading-placeholder">No conversations yet</div>'
        return
      }
      const conversationsHTML = conversations
        .map((conv) => {
          const lastMessage = conv.messages && conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null
          const lastMessageText = lastMessage ? (lastMessage.content || lastMessage.text || 'No message content') : 'No messages'
          const lastMessageTime = lastMessage ? new Date(lastMessage.timestamp).toLocaleString() : 'Unknown'
          const preview = (lastMessageText || '').substring(0, 100)
          const ellipsis = (lastMessageText || '').length > 100 ? '...' : ''
          return `
                <div class=\"conversation-item\">
                    <div class=\"conversation-info\">
                        <div class=\"conversation-user\">${conv.userId || 'Unknown User'}</div>
                        <div class=\"conversation-last-message\">${preview}${ellipsis}</div>
                    </div>
                    <div class=\"conversation-meta\">
                        <div>${conv.messages ? conv.messages.length : 0} messages</div>
                        <div>${lastMessageTime}</div>
                    </div>
                </div>
            `
        })
        .join('')
      conversationsContainer.innerHTML = conversationsHTML
    },

    async clearConversations(d) {
      if (!confirm('Are you sure you want to clear all conversations? This action cannot be undone.')) {
        return
      }
      try {
        const response = await fetch('/conversations', { method: 'DELETE' })
        if (response.ok) {
          d.showToast('Conversations cleared successfully!', 'success')
          d.loadConversations()
          d.loadStatus()
        } else {
          const error = await response.json()
          d.showToast(`Failed to clear conversations: ${error.message}`, 'error')
        }
      } catch (error) {
        console.error('Error clearing conversations:', error)
        d.showToast('Failed to clear conversations', 'error')
      }
    },

    getActiveChatsCount() {
      const conversationsContainer = document.getElementById('conversationsContainer')
      if (!conversationsContainer) return 0
      const conversations = conversationsContainer.querySelectorAll('.conversation-item')
      return conversations.length
    }
  }

  window.AppConversations = AppConversations
})()

