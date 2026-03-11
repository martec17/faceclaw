import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, Zap, Settings, Send, Trash2, ChevronRight, Globe, Search, Key, Bell, ChevronDown, RefreshCw } from 'lucide-react';
import './index.css';

import { initDB, getMessages, addMessage, getMemory, updateMemory, clearDB } from './db.js';

const STORAGE_KEY = 'picoclaw_settings';
const SERVER_URL = 'http://localhost:11435';

// Modelos de fallback caso o servidor não esteja disponível
const FALLBACK_MODELS = {
  gemini: [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
    { id: 'gemma2-9b-it', label: 'Gemma 2 9B' },
  ],
  openrouter: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (Free)' },
    { id: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1 (Free)' },
    { id: 'google/gemini-2.0-pro-exp-02-05:free', label: 'Gemini 2.0 Pro (Free)' },
  ],
};

const PROVIDERS = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'groq', label: 'Groq' },
  { value: 'openrouter', label: 'OpenRouter' },
];

function loadSettings() {
  try {
    const d = localStorage.getItem(STORAGE_KEY);
    return d ? JSON.parse(d) : { provider: 'gemini', apiKey: '', model: 'gemini-2.0-flash', heartbeat: false };
  } catch { return { provider: 'gemini', apiKey: '', model: 'gemini-2.0-flash', heartbeat: false }; }
}

function saveSettings(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { }
}

async function performWebSearch(query) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const results = Array.from(doc.querySelectorAll('.result__body')).slice(0, 3).map(el => {
      const title = el.querySelector('.result__title')?.textContent?.trim() || '';
      const snippet = el.querySelector('.result__snippet')?.textContent?.trim() || '';
      return `${title}: ${snippet}`;
    });
    return results.join('\n\n') || "Nenhum resultado encontrado.";
  } catch {
    return "Erro ao realizar busca web.";
  }
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const SUGGESTIONS = ['Resumir notícias recentes', 'Me ajude a programar', 'Planejar meu dia', 'Pesquisar na web'];

const AGENTS = [
  { icon: '🧩', title: 'Engenheiro Full-Stack', desc: 'Gere, revise e refatore código em Rust, TypeScript, Python e Go.', badge: 'Código', active: true },
  { icon: '🔎', title: 'Pesquisa Web', desc: 'Pesquise na internet, resuma resultados e extraia insights chave.', badge: 'Pesquisa', active: true },
  { icon: '🗂️', title: 'Planejador', desc: 'Gerencie tarefas e planeje projetos complexos com resultados estruturados.', badge: 'Planejamento', active: false },
  { icon: '📱', title: 'Assistente Android', desc: 'Transforme celulares velhos em assistentes IA via Termux ou APK.', badge: 'Mobile', active: false },
  { icon: '🐜', title: 'Deployer Edge', desc: 'Configure e implemente o PicoClaw em hardware de baixo consumo.', badge: 'Edge', active: false },
  { icon: '🔔', title: 'Monitor de Tarefas', desc: 'Roda tarefas periódicas a cada 30 min: email, clima e rotinas.', badge: 'Periódico', active: false },
];

// ---- Typing Indicator ----
function TypingIndicator() {
  return (
    <div className="typing-indicator">
      <div className="typing-avatar">🦾</div>
      <div className="typing-dots">
        <div className="dot" /><div className="dot" /><div className="dot" />
      </div>
    </div>
  );
}

// ---- Chat Screen ----
function ChatScreen({ messages, setMessages, settings }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const autoResize = () => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const callAPI = async (userMessage, newMessages, isSearchLoop = false) => {
    setLoading(true);
    try {
      const { provider, apiKey, model } = settings;
      if (!apiKey) throw new Error('Nenhuma chave de API configurada. Vá para as Configurações.');

      const memoryContext = await getMemory();
      const systemPrompt = `[SYSTEM] Você é o PicoClaw, um assistente de IA ultra-eficiente de bolso.\n[MEMÓRIA DE LONGO PRAZO]: ${memoryContext}\n\n[FERRAMENTA DE PESQUISA]: Se o usuário pedir para buscar algo na internet, ver notícias, ou precisar de uma informação em tempo real, VOCÊ DEVE APENAS responder com o formato exato: <search>termo de busca</search>. Eu realizarei a busca pra você e te darei o resultado para você finalizar a resposta. NÃO RESPONDA MAIS NADA se for fazer a busca.`;

      const messages_to_send = [
        { role: 'system', content: systemPrompt },
        ...newMessages.map(m => ({ role: m.role, content: m.content }))
      ];

      // Chamar via servidor Go
      let reply = '';
      try {
        const res = await fetch(`${SERVER_URL}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, apiKey, model, messages: messages_to_send })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        reply = data.reply || '(sem resposta)';
      } catch (serverErr) {
        // Fallback: chamada direta se servidor Go não disponível
        reply = await callDirectAPI(provider, apiKey, model, messages_to_send);
      }

      // Verificar tag <search>
      const searchMatch = reply.match(/<search>(.*?)<\/search>/i);
      if (searchMatch) {
        const query = searchMatch[1];
        const searchMsg = { id: Date.now(), role: 'assistant', content: `[PESQUISANDO NA WEB]: "${query}"...`, ts: Date.now() };
        await addMessage(searchMsg.role, searchMsg.content, searchMsg.ts);
        setMessages(prev => [...prev, searchMsg]);

        const results = await performWebSearch(query);
        const toolResponse = { id: Date.now() + 1, role: 'user', content: `[RESULTADOS DA PESQUISA PARA "${query}"]: \n\n${results}\n\nPor favor, responda o usuário baseando-se nestes resultados agindo como PicoClaw.`, ts: Date.now() + 1 };
        callAPI('', [...newMessages, searchMsg, toolResponse], true);
        return;
      }

      const assistantMsg = { id: Date.now(), role: 'assistant', content: reply, ts: Date.now() };
      await addMessage(assistantMsg.role, assistantMsg.content, assistantMsg.ts);
      setMessages(prev => [...prev, assistantMsg]);

      // Memory summarization (a cada 8 mensagens)
      if (newMessages.length > 0 && newMessages.length % 8 === 0 && !isSearchLoop) {
        const { provider: p, apiKey: k, model: m } = settings;
        const mPrompt = [
          { role: 'system', content: `Leia o contexto atual de memória: [${memoryContext}]. Agora leia as últimas mensagens e gere um NOVO CONTEXTO DE MEMÓRIA DE LONGO PRAZO compactado que contenha os dados mais importantes para lembrar no futuro. Retorne APENAS o texto livre resumido em português.` },
          ...newMessages.slice(-8).map(msg => ({ role: msg.role, content: msg.content }))
        ];
        (async () => {
          try {
            const res = await fetch(`${SERVER_URL}/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ provider: p, apiKey: k, model: m, messages: mPrompt })
            });
            const data = await res.json();
            if (data.reply && data.reply.trim()) await updateMemory(data.reply.trim());
          } catch { /* silencioso */ }
        })();
      }

    } catch (err) {
      const errMsg = { id: Date.now(), role: 'assistant', content: `⚠️ ${err.message}`, ts: Date.now() };
      await addMessage(errMsg.role, errMsg.content, errMsg.ts);
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  // Fallback: chamada direta ao provedor (caso servidor Go não esteja rodando)
  async function callDirectAPI(provider, apiKey, model, messages) {
    if (provider === 'gemini') {
      const contents = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      if (contents.length > 0 && messages[0]?.role === 'system') {
        contents[0].parts[0].text = messages[0].content + '\n\n' + contents[0].parts[0].text;
      }
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents }) }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '(sem resposta)';
    } else {
      const baseUrls = {
        openai: 'https://api.openai.com/v1',
        groq: 'https://api.groq.com/openai/v1',
        openrouter: 'https://openrouter.ai/api/v1',
      };
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://picoclaw.app';
        headers['X-Title'] = 'PicoClaw';
      }
      const res = await fetch(`${baseUrls[provider]}/chat/completions`, {
        method: 'POST', headers,
        body: JSON.stringify({ model, messages })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.choices?.[0]?.message?.content || '(sem resposta)';
    }
  }

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg = { id: Date.now(), role: 'user', content: text, ts: Date.now() };
    setInput('');
    if (textRef.current) textRef.current.style.height = '22px';
    await addMessage(userMsg.role, userMsg.content, userMsg.ts);
    setMessages(prev => {
      const updated = [...prev, userMsg];
      callAPI(text, updated);
      return updated;
    });
  }, [input, loading, settings]);

  const handleKey = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <>
      <div className="chat-container">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="empty-orb">🦾</div>
            <div>
              <div className="empty-title">Olá,<br /><em>Eu sou PicoClaw</em></div>
              <div className="empty-desc" style={{ marginTop: 8 }}>
                Assistente de IA ultra-eficiente. Rápido e leve. O que posso fazer por você?
              </div>
            </div>
            <div className="suggestion-chips">
              {SUGGESTIONS.map(s => (
                <button key={s} className="chip" onClick={() => { setInput(s); textRef.current?.focus(); }}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="bubble">{msg.content}</div>
              <div className="bubble-time">{formatTime(msg.ts)}</div>
            </div>
          ))
        )}
        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <div className="model-badge">
          <div className="model-dot" />
          {settings.model} · {PROVIDERS.find(p => p.value === settings.provider)?.label || settings.provider}
        </div>
        <div className="input-wrapper">
          <textarea
            ref={textRef}
            className="chat-input"
            placeholder="Mensagem para PicoClaw..."
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(); }}
            onKeyDown={handleKey}
            rows={1}
          />
          <button className="send-btn" onClick={send} disabled={!input.trim() || loading}>
            <Send size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

// ---- Agents Screen ----
function AgentsScreen({ onActivate }) {
  return (
    <div className="page">
      <div className="top-banner">
        <Zap size={14} color="var(--orange-primary)" />
        <span>Agentes PicoClaw — <strong style={{ color: 'var(--text-primary)' }}>toque em um agente para iniciar</strong></span>
      </div>
      <div style={{ height: 16 }} />
      <div className="section-title">Workflows Padrão</div>
      {AGENTS.map(agent => (
        <div key={agent.title} className="card" onClick={() => onActivate(agent)}>
          <div className="card-header">
            <div className="card-icon">{agent.icon}</div>
            <div>
              <div className="card-title">{agent.title}</div>
              <div className="card-subtitle">
                {agent.active ? <span className="status-pill"><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} /> Pronto</span>
                  : <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Configure a API key para ativar</span>}
              </div>
            </div>
          </div>
          <div className="card-desc">{agent.desc}</div>
          <div className="card-footer">
            <span className="badge badge-orange">{agent.badge}</span>
            <ChevronRight size={14} color="var(--text-muted)" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Settings Screen ----
function SettingsScreen({ settings, setSettings, onClear }) {
  const [expanded, setExpanded] = useState('api');
  const [models, setModels] = useState(FALLBACK_MODELS[settings.provider] || []);
  const [loadingModels, setLoadingModels] = useState(false);
  const [serverOk, setServerOk] = useState(null);

  const provider = PROVIDERS.find(p => p.value === settings.provider) || PROVIDERS[0];

  const update = (key, val) => setSettings(prev => {
    const s = { ...prev, [key]: val };
    saveSettings(s);
    return s;
  });

  const fetchModels = async (prov, key) => {
    if (!key) {
      setModels(FALLBACK_MODELS[prov] || []);
      return;
    }
    setLoadingModels(true);
    try {
      const res = await fetch(`${SERVER_URL}/models?provider=${prov}&apiKey=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (Array.isArray(data) && data.length > 0) {
        setModels(data);
        setServerOk(true);
        // Atualiza modelo selecionado se o atual não estiver na lista
        if (!data.find(m => m.id === settings.model)) {
          update('model', data[0].id);
        }
      } else {
        setModels(FALLBACK_MODELS[prov] || []);
      }
    } catch {
      setServerOk(false);
      setModels(FALLBACK_MODELS[prov] || []);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    fetchModels(settings.provider, settings.apiKey);
  }, [settings.provider, settings.apiKey]);

  const handleProviderChange = (val) => {
    update('provider', val);
    const fallback = FALLBACK_MODELS[val];
    setModels(fallback || []);
    if (fallback && fallback.length > 0) update('model', fallback[0].id);
    if (settings.apiKey) fetchModels(val, settings.apiKey);
  };

  return (
    <div className="page">
      <div className="section-title">Configurações de Provedor</div>

      {/* Provedor */}
      <div className="expand-card">
        <div className="expand-header" onClick={() => setExpanded(expanded === 'api' ? null : 'api')}>
          <div className="settings-label">
            <div className="settings-icon"><Globe size={16} /></div>
            <div>
              <div className="settings-text">Provedor de IA</div>
              <div className="settings-sub">{provider.label}</div>
            </div>
          </div>
          <ChevronDown size={16} color="var(--text-muted)" style={{ transform: expanded === 'api' ? 'rotate(180deg)' : 'none', transition: '0.25s' }} />
        </div>
        {expanded === 'api' && (
          <div className="expand-body">
            <select className="settings-select" style={{ width: '100%', padding: '10px 14px' }} value={settings.provider} onChange={e => handleProviderChange(e.target.value)}>
              {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <input className="settings-input" type="password" placeholder="Chave de API (API Key)..." value={settings.apiKey} onChange={e => update('apiKey', e.target.value)} />

            {/* Seletor de modelos com busca dinâmica */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <select className="settings-select" style={{ flex: 1, padding: '10px 14px' }} value={settings.model} onChange={e => update('model', e.target.value)}>
                {models.map(m => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
              </select>
              <button
                onClick={() => fetchModels(settings.provider, settings.apiKey)}
                disabled={loadingModels}
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px', cursor: 'pointer', color: 'var(--text-primary)' }}
                title="Atualizar lista de modelos"
              >
                <RefreshCw size={15} style={{ animation: loadingModels ? 'spin 1s linear infinite' : 'none' }} />
              </button>
            </div>

            {/* Status do servidor Go */}
            {serverOk === true && (
              <div style={{ fontSize: 11, color: '#4ade80', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
                Modelos carregados da API · {models.length} disponíveis
              </div>
            )}
            {serverOk === false && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                ℹ️ Usando lista padrão (servidor offline ou key inválida)
              </div>
            )}

            <button className="btn-primary" onClick={() => setExpanded(null)}>
              <Key size={15} /> Salvar Configuração
            </button>
          </div>
        )}
      </div>

      <div className="divider" />
      <div className="section-title">Preferências</div>

      <div className="settings-item">
        <div className="settings-label">
          <div className="settings-icon"><Bell size={16} /></div>
          <div>
            <div className="settings-text">Tarefas Contínuas</div>
            <div className="settings-sub">Automação de agentes (30 min)</div>
          </div>
        </div>
        <div className={`toggle ${settings.heartbeat ? 'on' : ''}`} onClick={() => update('heartbeat', !settings.heartbeat)}>
          <div className="toggle-thumb" />
        </div>
      </div>

      <div className="divider" />
      <div className="section-title">Sobre</div>
      <div className="card" style={{ cursor: 'default' }}>
        <div className="card-header">
          <div className="card-icon">🦾</div>
          <div>
            <div className="card-title">PicoClaw Mobile</div>
            <div className="card-subtitle">v2.0.0 · Backend Go · IA Multi-Provedor</div>
          </div>
        </div>
        <div className="card-desc">
          Inteligência em qualquer lugar. Suporta Gemini, OpenAI, Groq e OpenRouter com busca dinâmica de modelos compatíveis via servidor Go.
        </div>
        <div className="card-footer">
          <span className="badge badge-green">Código Aberto</span>
          <span className="badge badge-orange">Go Backend</span>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="btn-danger" onClick={onClear}>
          <Trash2 size={15} /> Apagar Todas Conversas
        </button>
      </div>
      <div style={{ height: 16 }} />
    </div>
  );
}

// ---- Root App ----
export default function App() {
  const [tab, setTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [settings, setSettings] = useState(loadSettings);
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    const setup = async () => {
      const isReady = await initDB();
      if (isReady && mounted) {
        setDbReady(true);
        const imgs = await getMessages();
        setMessages(imgs.map(m => ({ id: m.id, role: m.role, content: m.content, ts: m.timestamp })));
      }
    };
    setup();
    return () => { mounted = false; };
  }, []);

  const clearChat = async () => {
    await clearDB();
    setMessages([]);
  };

  const activateAgent = async (agent) => {
    const prompt = `[Agente: ${agent.title}] ${agent.desc}\n\nComo posso ajudá-lo com ${agent.title.toLowerCase()} hoje?`;
    const ts = Date.now();
    await addMessage('assistant', prompt, ts);
    setMessages(prev => [...prev, { id: ts, role: 'assistant', content: prompt, ts }]);
    setTab('chat');
  };

  if (!dbReady) {
    return <div className="app" style={{ justifyContent: 'center', alignItems: 'center' }}><div className="empty-orb">🦾</div></div>;
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-logo">
          <div className="header-icon">🦾</div>
          <div>
            <div className="header-title">PicoClaw</div>
            <div className="header-subtitle">Assistente de IA</div>
          </div>
        </div>
        <div className="header-actions">
          {tab === 'chat' && messages.length > 0 && (
            <button className="icon-btn" onClick={clearChat} title="Limpar chat">
              <Trash2 size={15} />
            </button>
          )}
          <button className={`icon-btn ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab(t => t === 'settings' ? 'chat' : 'settings')}>
            <Settings size={15} />
          </button>
        </div>
      </header>

      <div className="screen">
        {tab === 'chat' && <ChatScreen messages={messages} setMessages={setMessages} settings={settings} />}
        {tab === 'agents' && <AgentsScreen onActivate={activateAgent} />}
        {tab === 'settings' && <SettingsScreen settings={settings} setSettings={setSettings} onClear={clearChat} />}
      </div>

      <nav className="bottom-nav">
        {[
          { id: 'chat', icon: <MessageSquare size={20} />, label: 'Chat' },
          { id: 'agents', icon: <Zap size={20} />, label: 'Agentes' },
          { id: 'settings', icon: <Settings size={20} />, label: 'Ajustes' },
        ].map(n => (
          <button key={n.id} className={`nav-item ${tab === n.id ? 'active' : ''}`} onClick={() => setTab(n.id)}>
            {n.icon}
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
