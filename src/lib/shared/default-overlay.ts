export const DEFAULT_OVERLAY_SOURCE = `<script>
  const MAX_MESSAGES = 10;
  const messages = [];
  const statusEl = document.getElementById('status');
  const messagesEl = document.getElementById('messages');

  const toMessageText = (parts) => {
    if (!Array.isArray(parts)) {
      return '';
    }

    return parts
      .map((part) => {
        if (!part || typeof part !== 'object') {
          return '';
        }

        const text = typeof part.text === 'string' ? part.text : '';
        const alt = typeof part.alt === 'string' ? part.alt : '';
        return text || alt;
      })
      .join('');
  };

  const render = () => {
    if (!messagesEl || !statusEl) {
      return;
    }

    messagesEl.innerHTML = '';

    for (const msg of messages) {
      const item = document.createElement('div');
      item.className = 'message';

      const avatar = document.createElement('img');
      const avatarUrl = msg?.author?.thumbnail?.url;
      avatar.src = typeof avatarUrl === 'string' ? avatarUrl : '';
      avatar.alt = typeof msg?.author?.name === 'string' ? msg.author.name : 'avatar';

      const author = document.createElement('b');
      author.textContent = typeof msg?.author?.name === 'string' ? msg.author.name : 'unknown';

      const text = document.createElement('span');
      text.textContent = toMessageText(msg?.message);

      item.append(avatar, author, text);
      messagesEl.appendChild(item);
    }

    statusEl.textContent = messages.length === 0 ? 'Waiting for chat messages...' : '';
  };

  window.chat.subscribe((msg) => {
    messages.push(msg);
    if (messages.length > MAX_MESSAGES) {
      messages.splice(0, messages.length - MAX_MESSAGES);
    }
    render();
  });

  render();
</script>

<div class="chat">
  <div id="status" class="status"></div>
  <div id="messages" class="messages"></div>
</div>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    align-items: start;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .message {
    display: grid;
    grid-template-columns: 32px auto 1fr;
    gap: 8px;
    align-items: center;
    background: rgba(0, 0, 0, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    color: #fff;
    padding: 8px 12px;
    width: fit-content;
    max-width: min(900px, 95vw);
  }

  .status {
    color: white;
    background: rgba(0, 0, 0, 0.45);
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 12px;
  }

  img {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
  }

  b {
    white-space: nowrap;
  }

  span {
    overflow-wrap: anywhere;
  }
</style>
`;
