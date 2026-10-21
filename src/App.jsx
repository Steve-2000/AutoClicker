import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Inline SVG Icons ────────────────────────────────────────────────────────

const Icon = {
  Refresh: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  ),
  Play: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  ),
  Stop: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
    </svg>
  ),
  Target: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  Click: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 9l11 1.5-4.5 3 1.5 5.5L9 9z"/>
    </svg>
  ),
  Apps: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  ),
  Screenshot: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  ),
  Mouse: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="7"/><line x1="12" y1="2" x2="12" y2="10"/>
    </svg>
  ),
};

// App icon map for common processes
const APP_ICONS = {
  msedge: '🌐',
  chrome: '🟡',
  firefox: '🦊',
  notepad: '📝',
  code: '💻',
  explorer: '📁',
  vlc: '🎬',
  discord: '💬',
  slack: '💬',
  spotify: '🎵',
  default: '🖥️',
};

function getAppIcon(procName) {
  const n = (procName || '').toLowerCase();
  for (const [key, icon] of Object.entries(APP_ICONS)) {
    if (key !== 'default' && n.includes(key)) return icon;
  }
  return APP_ICONS.default;
}

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const api = window.electronAPI;

  const [windows, setWindows] = useState([]);
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [selectedWin, setSelectedWin] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState(null);
  const [screenshot, setScreenshot] = useState(null);      // base64 jpeg
  const [winBounds, setWinBounds] = useState(null);        // {left,top,width,height}
  const TARGET_COLORS = ['#10b981', '#a78bfa', '#06b6d4', '#f59e0b', '#ec4899', '#3b82f6'];
  const [selectingMode, setSelectingMode] = useState(false);
  const [targets, setTargets] = useState([]);              // [{ id, name, screenX, screenY, xPct, yPct, color }]
  const [isRunning, setIsRunning] = useState(false);
  const [clickCount, setClickCount] = useState(0);
  const [intervalMs, setIntervalMs] = useState(500);
  const [maxClicks, setMaxClicks] = useState(0);
  const [logs, setLogs] = useState([]);
  const imgRef = useRef(null);
  const refreshTimerRef = useRef(null);

  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [{ msg, type, time: ts() }, ...prev].slice(0, 80));
  }, []);

  // ── Load windows ─────────────────────────────────────────────────────────

  const loadWindows = useCallback(async () => {
    if (!api) return;
    setLoadingWindows(true);
    try {
      const result = await api.getWindows();
      setWindows(result || []);
      if (result?.length) addLog(`Found ${result.length} running window(s)`, 'success');
      else addLog('No windows found', 'error');
    } catch (e) {
      addLog('Failed to list windows: ' + e.message, 'error');
    }
    setLoadingWindows(false);
  }, [api, addLog]);

  useEffect(() => { loadWindows(); }, []);

  // ── CDP events ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!api) return;
    api.onClickFired((d) => {
      setClickCount(d.count);
      if (d.count % 10 === 0 || d.count <= 5) {
        addLog(`Click #${d.count}`, 'success');
      }
    });
    api.onAutoClickStopped((d) => {
      setIsRunning(false);
      addLog(`Auto-click stopped (${d.count} total clicks)`, 'info');
    });
    return () => {
      api.removeAllListeners('click-fired');
      api.removeAllListeners('auto-click-stopped');
    };
  }, [api, addLog]);

  // ── Capture window screenshot ─────────────────────────────────────────────

  const captureWindow = useCallback(async (win) => {
    if (!api || capturing) return;
    setCapturing(true);
    setCaptureError(null);
    setScreenshot(null);
    setSelectedWin(win);
    setSelectingMode(false);
    addLog(`Capturing: ${win.title}...`, 'info');
    try {
      const res = await api.captureWindow(win.handle);
      if (res.error) {
        setCaptureError(res.error);
        addLog('Capture failed: ' + res.error, 'error');
      } else {
        setScreenshot(res.screenshot);
        setWinBounds(res.bounds);
        setCaptureError(null);
        addLog(`Screenshot ready (${res.bounds.width}×${res.bounds.height})`, 'success');
      }
    } catch (e) {
      setCaptureError(e.message);
      addLog('Error: ' + e.message, 'error');
    }
    setCapturing(false);
  }, [api, capturing, addLog]);

  // ── Auto-refresh screenshot while not running ─────────────────────────────

  const refreshScreenshot = useCallback(async () => {
    if (!api || !selectedWin || capturing || isRunning) return;
    try {
      const res = await api.captureWindow(selectedWin.handle);
      if (res.screenshot) {
        setScreenshot(res.screenshot);
        if (res.bounds) setWinBounds(res.bounds);
      }
    } catch (_) {}
  }, [api, selectedWin, capturing, isRunning]);

  useEffect(() => {
    if (selectedWin && !isRunning) {
      refreshTimerRef.current = setInterval(refreshScreenshot, 2500);
    } else {
      clearInterval(refreshTimerRef.current);
    }
    return () => clearInterval(refreshTimerRef.current);
  }, [selectedWin, isRunning, refreshScreenshot]);

  // ── Handle image click to add target ─────────────────────────────────────

  const handleImageClick = useCallback(async (e) => {
    if (!selectingMode || !api) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const imgX = e.clientX - rect.left;
    const imgY = e.clientY - rect.top;
    const imgW = rect.width;
    const imgH = rect.height;

    const res = await api.setClickTarget({ imgX, imgY, imgW, imgH });
    if (res.error) {
      addLog('Error: ' + res.error, 'error');
      return;
    }

    let r = null, g = null, b = null, hexColor = null;
    try {
      const img = imgRef.current;
      if (img && img.naturalWidth && img.naturalHeight) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const pixelX = Math.min(img.naturalWidth - 1, Math.max(0, Math.round((imgX / imgW) * img.naturalWidth)));
        const pixelY = Math.min(img.naturalHeight - 1, Math.max(0, Math.round((imgY / imgH) * img.naturalHeight)));
        const pixelData = ctx.getImageData(pixelX, pixelY, 1, 1).data;
        r = pixelData[0];
        g = pixelData[1];
        b = pixelData[2];
        hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      }
    } catch (err) {
      console.warn('Pixel sample error:', err);
    }

    const nextIdx = targets.length;
    const color = TARGET_COLORS[nextIdx % TARGET_COLORS.length];
    const defaultName = nextIdx === 0 ? 'Upgrade Button' : nextIdx === 1 ? 'Continue Playing' : `Button ${nextIdx + 1}`;

    const newTarget = {
      id: Date.now() + Math.random(),
      name: defaultName,
      screenX: res.screenX,
      screenY: res.screenY,
      xPct: imgX / imgW,
      yPct: imgY / imgH,
      color,
      r,
      g,
      b,
      hexColor: hexColor || color,
      colorDetect: true,
    };

    setTargets(prev => [...prev, newTarget]);
    setSelectingMode(false);
    addLog(`Target #${nextIdx + 1} locked: "${defaultName}" (Color: ${hexColor || color}) → (${res.screenX}, ${res.screenY})`, 'success');
  }, [selectingMode, api, targets.length, addLog]);

  const removeTarget = useCallback((id) => {
    setTargets(prev => prev.filter(t => t.id !== id));
    addLog('Target removed', 'info');
  }, [addLog]);

  const updateTargetName = useCallback((id, name) => {
    setTargets(prev => prev.map(t => t.id === id ? { ...t, name } : t));
  }, []);

  const toggleColorDetect = useCallback((id) => {
    setTargets(prev => prev.map(t => t.id === id ? { ...t, colorDetect: !t.colorDetect } : t));
  }, []);

  const handleTestClick = useCallback(async (t) => {
    if (!api || !t) return;
    addLog(`Testing click on "${t.name}" at (${t.screenX}, ${t.screenY})...`, 'info');
    const res = await api.doSingleClick(t);
    if (res?.ok) {
      addLog(`Clicked "${t.name}" ✓`, 'success');
    } else {
      addLog('Click error: ' + (res?.error || '?'), 'error');
    }
  }, [api, addLog]);

  // ── Start / Stop ──────────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    if (!api || targets.length === 0) return;
    setClickCount(0);
    setIsRunning(true);
    addLog(`▶ Auto-clicking ${targets.length} target(s) every ${intervalMs}ms` + (maxClicks > 0 ? `, stop at ${maxClicks}` : ''), 'info');
    await api.startAutoClick({ targets, intervalMs: Number(intervalMs), maxClicks: Number(maxClicks) });
  }, [api, targets, intervalMs, maxClicks, addLog]);

  const handleStop = useCallback(async () => {
    if (!api) return;
    await api.stopAutoClick();
    setIsRunning(false);
    addLog('■ Stopped.', 'info');
  }, [api, addLog]);

  // ── Steps ─────────────────────────────────────────────────────────────────

  const steps = [
    { done: windows.length > 0, label: 'Select Hazmob or Entire Screen' },
    { done: !!screenshot,        label: 'Preview window loaded' },
    { done: targets.length > 0,  label: `Target buttons added (${targets.length})` },
    { done: isRunning,           label: 'Start auto-clicking' },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* Titlebar */}
      <div className="titlebar-spacer">
        <div className="titlebar-logo">
          <div className="titlebar-logo-icon">⚡</div>
          <span className="titlebar-logo-text">AutoClicker</span>
        </div>
        <div className="titlebar-status">
          <div className={`status-dot ${isRunning ? 'running' : screenshot ? 'connected' : ''}`} />
          {isRunning ? (
            <span className="running-badge"><span className="dot" />Auto-clicking</span>
          ) : screenshot ? (
            <span style={{ color: 'var(--green)', fontSize: 11 }}>Window captured</span>
          ) : (
            <span>Idle</span>
          )}
        </div>
      </div>

      {/* Layout */}
      <div className="main-layout">
        {/* ── Sidebar ── */}
        <aside className="sidebar">

          {/* Setup guide */}
          <div className="sidebar-section">
            <div className="section-title"><Icon.Target /> Setup Guide</div>
            <div className="instructions-card">
              {steps.map((s, i) => (
                <div className="instruction-step" key={i}>
                  <div className={`step-num ${s.done ? 'done' : ''}`}>{s.done ? '✓' : i + 1}</div>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Window list */}
          <div className="sidebar-section">
            <div className="section-title">
              <Icon.Apps /> Running Apps
              <button
                id="refresh-windows-btn"
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 'auto', padding: '2px 8px' }}
                onClick={loadWindows}
                disabled={loadingWindows}
                title="Refresh window list"
              >
                {loadingWindows
                  ? <div className="loading-spinner" style={{ width: 10, height: 10, borderWidth: 2 }} />
                  : <Icon.Refresh />}
                Refresh
              </button>
            </div>

            {windows.length === 0 ? (
              <div className="no-tabs-msg">
                <strong>No windows found</strong>
                Open any app and click Refresh
              </div>
            ) : (
              <div className="tabs-list">
                {windows.map((win) => (
                  <div
                    key={win.handle}
                    id={`win-${win.handle}`}
                    className={`tab-item ${selectedWin?.handle === win.handle ? 'active' : ''}`}
                    onClick={() => !capturing && captureWindow(win)}
                    title={`PID ${win.id} — ${win.name}`}
                  >
                    <div className="tab-favicon">
                      {win.icon ? (
                        <img src={win.icon} alt="" style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'contain' }} />
                      ) : (
                        <span style={{ fontSize: 15 }}>{getAppIcon(win.name)}</span>
                      )}
                    </div>
                    <div className="tab-info">
                      <div className="tab-title">{win.title}</div>
                      <div className="tab-url">{win.name}</div>
                    </div>
                    {capturing && selectedWin?.handle === win.handle && (
                      <div className="loading-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="refresh-hint">Click any window to screenshot it</div>
          </div>

          {/* Controls */}
          <div className="controls-section">

            {/* Target section */}
            <div className="sidebar-section">
              <div className="section-title">
                <Icon.Target /> Click Targets ({targets.length})
                {targets.length > 0 && (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginLeft: 'auto', padding: '2px 6px', fontSize: 10, color: 'var(--red, #ef4444)' }}
                    onClick={() => { setTargets([]); addLog('All targets cleared', 'info'); }}
                    title="Clear all targets"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Targets List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {targets.map((t, idx) => (
                  <div
                    key={t.id}
                    style={{
                      background: 'var(--bg-card)',
                      border: `1px solid ${t.color}55`,
                      borderLeft: `4px solid ${t.color}`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: t.color,
                            color: '#fff',
                            fontSize: 10,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {idx + 1}
                        </span>
                        <input
                          type="text"
                          value={t.name}
                          onChange={(e) => updateTargetName(t.id, e.target.value)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-primary)',
                            fontSize: 12,
                            fontWeight: 600,
                            width: '100%',
                            outline: 'none',
                          }}
                          placeholder="Target name"
                        />
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '1px 5px', color: 'var(--text-dim)', fontSize: 11 }}
                        onClick={() => removeTarget(t.id)}
                        title="Delete target"
                      >
                        ✕
                      </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono' }}>
                        X: {t.screenX} · Y: {t.screenY}
                      </span>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '2px 8px', fontSize: 10, borderColor: `${t.color}66`, color: t.color }}
                        onClick={() => handleTestClick(t)}
                        title="Click this button right now to test"
                      >
                        ⚡ Test
                      </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: t.colorDetect !== false ? 'var(--text-primary)' : 'var(--text-dim)', userSelect: 'none' }}>
                        <input
                          type="checkbox"
                          checked={t.colorDetect !== false}
                          onChange={() => toggleColorDetect(t.id)}
                          style={{ accentColor: t.color, cursor: 'pointer' }}
                        />
                        <span>Click only when visible</span>
                      </label>
                      {t.hexColor && (
                        <span
                          style={{
                            marginLeft: 'auto',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 9,
                            color: 'var(--text-dim)',
                            fontFamily: 'JetBrains Mono',
                          }}
                          title={`Detected button color: ${t.hexColor}`}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 2,
                              background: t.hexColor,
                              border: '1px solid rgba(255,255,255,0.3)',
                              display: 'inline-block',
                            }}
                          />
                          {t.hexColor}
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {targets.length === 0 && (
                  <div className="target-display empty" style={{ textAlign: 'center', padding: '14px 10px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
                      No button targets added
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
                      Click below, then click your <strong>Upgrade</strong> and <strong>Continue playing</strong> buttons in the preview!
                    </div>
                  </div>
                )}
              </div>

              <button
                id="select-target-btn"
                className="btn btn-ghost btn-sm btn-full"
                style={
                  selectingMode
                    ? { borderColor: 'var(--purple)', color: 'var(--purple-light)', background: 'var(--purple-dim)' }
                    : { borderColor: 'var(--border-bright)' }
                }
                onClick={() => setSelectingMode((m) => !m)}
                disabled={!screenshot}
              >
                <Icon.Target />
                {selectingMode ? '🎯 Click on button in preview...' : '+ Add Target Button'}
              </button>
            </div>

            {/* Auto-click settings */}
            <div className="sidebar-section">
              <div className="section-title"><Icon.Mouse /> Auto-Click Settings</div>

              <div className="input-group">
                <div className="input-label">
                  <span>Interval</span>
                  <span style={{ color: 'var(--purple-light)', fontFamily: 'JetBrains Mono' }}>{intervalMs}ms</span>
                </div>
                <input
                  id="interval-input"
                  type="number"
                  className="input-field"
                  value={intervalMs}
                  min={50}
                  max={60000}
                  onChange={e => setIntervalMs(e.target.value)}
                  disabled={isRunning}
                />
              </div>

              <div className="input-group">
                <div className="input-label">
                  <span>Max Clicks</span>
                  <span style={{ color: 'var(--cyan)', fontFamily: 'JetBrains Mono' }}>
                    {maxClicks === 0 || maxClicks === '0' ? '∞' : maxClicks}
                  </span>
                </div>
                <input
                  id="max-clicks-input"
                  type="number"
                  className="input-field"
                  value={maxClicks}
                  min={0}
                  onChange={e => setMaxClicks(e.target.value)}
                  placeholder="0 = unlimited"
                  disabled={isRunning}
                />
              </div>

              <div className="click-counter">
                <div className="counter-value">{clickCount.toLocaleString()}</div>
                <div className="counter-label">Total Clicks</div>
                {Number(maxClicks) > 0 && (
                  <div className="counter-sub">/ {Number(maxClicks).toLocaleString()} max</div>
                )}
              </div>

              {!isRunning ? (
                <button
                  id="start-btn"
                  className="btn btn-primary btn-full"
                  onClick={handleStart}
                  disabled={targets.length === 0}
                >
                  <Icon.Play /> {targets.length > 0 ? `Start Auto-Clicking (${targets.length})` : 'Start Auto-Clicking'}
                </button>
              ) : (
                <button
                  id="stop-btn"
                  className="btn btn-danger btn-full"
                  onClick={handleStop}
                >
                  <Icon.Stop /> Stop
                </button>
              )}
            </div>

            {/* Log */}
            <div className="log-feed">
              <div className="section-title">Activity Log</div>
              <div className="log-items">
                {logs.map((l, i) => (
                  <div key={i} className={`log-item ${l.type}`}>
                    <span className="log-time">{l.time}</span>
                    <span>{l.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* ── Preview Pane ── */}
        <main className="preview-pane">
          <div className="preview-toolbar">
            <div className="preview-toolbar-title">
              {selectedWin ? selectedWin.title : 'Live Preview'}
              {winBounds && (
                <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono' }}>
                  {winBounds.width}×{winBounds.height}
                </span>
              )}
            </div>

            {screenshot && (
              <>
                <button
                  id="refresh-screenshot-btn"
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => selectedWin && captureWindow(selectedWin)}
                  disabled={capturing}
                >
                  {capturing
                    ? <div className="loading-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                    : <Icon.Screenshot />}
                  Refresh
                </button>

                <div className="preview-mode-toggle">
                  <button
                    className={`mode-btn ${!selectingMode ? 'active' : ''}`}
                    onClick={() => setSelectingMode(false)}
                  >
                    View
                  </button>
                  <button
                    id="mode-select-btn"
                    className={`mode-btn ${selectingMode ? 'active' : ''}`}
                    onClick={() => setSelectingMode(true)}
                  >
                    🎯 Select
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="preview-area">
            {capturing ? (
              <div className="preview-empty">
                <div className="loading-spinner" />
                <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 8 }}>Capturing window...</div>
              </div>
            ) : captureError ? (
              <div className="preview-empty">
                <div className="preview-empty-icon">⚠️</div>
                <div className="preview-empty-title" style={{ color: 'var(--red, #f87171)' }}>Capture Failed</div>
                <div className="preview-empty-sub" style={{ maxWidth: 420 }}>
                  {captureError}
                </div>
                {selectedWin && (
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ marginTop: 16 }}
                    onClick={() => captureWindow(selectedWin)}
                  >
                    🔄 Try Capturing Again
                  </button>
                )}
              </div>
            ) : !screenshot ? (
              <div className="preview-empty">
                <div className="preview-empty-icon">🖥️</div>
                <div className="preview-empty-title">
                  {selectedWin ? 'Click to Capture Preview' : 'No Window Selected'}
                </div>
                <div className="preview-empty-sub">
                  {windows.length === 0
                    ? 'Click Refresh to find running apps, then click one to capture it.'
                    : selectedWin
                    ? `Click the tab "${selectedWin.title}" again or click Refresh to capture.`
                    : 'Click any window in the sidebar to take a screenshot preview.'}
                </div>
                <div style={{ marginTop: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 20px', maxWidth: 340 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>✨ No setup required</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    Just open <strong style={{ color: 'var(--purple-light)' }}>Microsoft Edge</strong> (or any app) normally — no special flags or settings needed!
                  </div>
                </div>
              </div>
            ) : (
              <div
                className={`screenshot-container fade-in ${selectingMode ? 'selecting-mode' : ''}`}
                style={{ border: selectingMode ? '2px solid var(--purple)' : undefined }}
              >
                <img
                  ref={imgRef}
                  id="preview-screenshot"
                  src={`data:image/jpeg;base64,${screenshot}`}
                  alt="Window preview"
                  className="screenshot-img"
                  draggable={false}
                />

                {selectingMode && (
                  <>
                    <div className="selection-hint">🎯 Click on any button to set it as the auto-click target</div>
                    <div
                      id="screenshot-click-layer"
                      className="screenshot-clickable-layer"
                      onClick={handleImageClick}
                    />
                  </>
                )}

                {targets.map((t, idx) => (
                  <div
                    key={t.id}
                    className="target-marker"
                    style={{
                      left: `${t.xPct * 100}%`,
                      top: `${t.yPct * 100}%`,
                    }}
                    title={`${t.name} (X: ${t.screenX}, Y: ${t.screenY})`}
                    onClick={() => handleTestClick(t)}
                  >
                    <div
                      className="target-marker-inner"
                      style={{
                        borderColor: t.color,
                        background: `${t.color}44`,
                        boxShadow: `0 0 10px ${t.color}`,
                      }}
                    >
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>{idx + 1}</span>
                    </div>
                    <div
                      className="target-marker-label"
                      style={{
                        background: 'rgba(10,10,15,0.9)',
                        border: `1px solid ${t.color}`,
                        color: t.color,
                      }}
                    >
                      {t.name}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
