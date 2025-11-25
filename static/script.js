document.addEventListener('DOMContentLoaded', () => {
    const initBtn = document.getElementById('init-btn');
    const statusText = document.getElementById('status-text');
    const statusIndicator = document.querySelector('.status-indicator');
    const userInput = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const chatContainer = document.getElementById('chat-container');
    const tagBtns = document.querySelectorAll('.tag-btn');

    let isSystemReady = false;

    // 自动滚动到底部
    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // 添加消息到聊天界面
    function addMessage(role, content, sources = null) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}-message`;

        let htmlContent = content;
        // 使用 marked.js 解析 Markdown
        htmlContent = marked.parse(htmlContent);

        msgDiv.innerHTML = `<div class="content markdown-body">${htmlContent}</div>`;

        if (sources && sources.length > 0) {
            const sourcesDiv = document.createElement('div');
            sourcesDiv.className = 'sources-container';
            sourcesDiv.innerHTML = '<div style="margin-top:10px;font-size:12px;color:#666;">📚 参考来源:</div>';

            sources.forEach(source => {
                const sourceCard = document.createElement('div');
                sourceCard.className = 'source-card';
                sourceCard.innerHTML = `
                    <div class="source-title">${source.dish_name}</div>
                    <div class="source-meta">🏷️ ${source.category} | 🔥 ${source.difficulty}</div>
                    <div style="color: #444; font-size: 0.9em;">${source.content}...</div>
                `;
                sourcesDiv.appendChild(sourceCard);
            });
            msgDiv.appendChild(sourcesDiv);
        }

        chatContainer.appendChild(msgDiv);
        scrollToBottom();
        return msgDiv;
    }

    // 初始化系统
    initBtn.addEventListener('click', async () => {
        if (isSystemReady) return;

        initBtn.disabled = true;
        initBtn.textContent = '⏳ 正在启动...';

        try {
            const response = await fetch('/api/init', { method: 'POST' });
            const data = await response.json();

            if (data.status === 'success') {
                isSystemReady = true;
                statusText.textContent = '系统在线';
                statusIndicator.classList.remove('offline');
                statusIndicator.classList.add('online');
                initBtn.textContent = '✅ 系统已就绪';

                userInput.disabled = false;
                sendBtn.disabled = false;

                // 移除初始提示
                const systemMsg = document.querySelector('.system-message');
                if (systemMsg) systemMsg.remove();

                addMessage('assistant', '👋 您好！我是您的 AI 厨艺导师。请问今天想吃点什么？');
            } else {
                alert('启动失败: ' + data.message);
                initBtn.disabled = false;
                initBtn.textContent = '🚀 启动美食引擎';
            }
        } catch (error) {
            console.error('Error:', error);
            alert('启动出错，请检查控制台日志');
            initBtn.disabled = false;
            initBtn.textContent = '🚀 启动美食引擎';
        }
    });

    // 发送消息
    async function sendMessage() {
        const text = userInput.value.trim();
        if (!text || !isSystemReady) return;

        // 清空输入
        userInput.value = '';

        // 添加用户消息
        addMessage('user', text);

        // 创建助手消息占位符
        const assistantMsgDiv = document.createElement('div');
        assistantMsgDiv.className = 'message assistant-message';
        assistantMsgDiv.innerHTML = '<div class="content markdown-body">🍳 正在思考...</div>';
        chatContainer.appendChild(assistantMsgDiv);
        scrollToBottom();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: text, stream: true })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';
            let sources = [];
            let isFirstChunk = true;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const json = JSON.parse(line);

                        if (json.type === 'sources') {
                            sources = json.data;
                        } else if (json.type === 'content') {
                            if (isFirstChunk) {
                                assistantMsgDiv.querySelector('.content').innerHTML = ''; // 清除"正在思考"
                                isFirstChunk = false;
                            }
                            fullContent += json.data;
                            // 使用 marked.js 解析 Markdown
                            assistantMsgDiv.querySelector('.content').innerHTML = marked.parse(fullContent);
                            scrollToBottom();
                        }
                    } catch (e) {
                        console.error('Parse error:', e);
                    }
                }
            }

            // 最后添加来源
            if (sources.length > 0) {
                const sourcesDiv = document.createElement('div');
                sourcesDiv.className = 'sources-container';
                sourcesDiv.innerHTML = '<div style="margin-top:10px;font-size:12px;color:#666;">📚 参考来源:</div>';

                sources.forEach(source => {
                    const sourceCard = document.createElement('div');
                    sourceCard.className = 'source-card';
                    sourceCard.innerHTML = `
                        <div class="source-title">${source.dish_name}</div>
                        <div class="source-meta">🏷️ ${source.category} | 🔥 ${source.difficulty}</div>
                        <div style="color: #444; font-size: 0.9em;">${source.content}...</div>
                    `;
                    sourcesDiv.appendChild(sourceCard);
                });
                assistantMsgDiv.appendChild(sourcesDiv);
                scrollToBottom();
            }

        } catch (error) {
            console.error('Chat error:', error);
            assistantMsgDiv.querySelector('.content').textContent = '抱歉，发生了一些错误。';
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // 灵感标签点击
    tagBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (!isSystemReady) {
                alert('请先启动系统！');
                return;
            }
            userInput.value = btn.dataset.query;
            sendMessage();
        });
    });
});
