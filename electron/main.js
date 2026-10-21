const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
let mainWindow;

// Stored state
let windowHandle = null;      // HWND of selected window (as number)
let windowBounds = null;      // { left, top, width, height }
let targetScreen = null;      // { x, y } absolute screen coords
let autoClickProcess = null;  // spawned powershell process

// ─── Helper: Run a PowerShell command string ──────────────────────────────────

function runPS(command) {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', command,
    ]);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0 && !out) reject(new Error(err || `PS exited ${code}`));
      else resolve(out.trim());
    });
  });
}

// ─── Helper: Scripts path ─────────────────────────────────────────────────────

function scriptPath(name) {
  if (isDev) return path.join(__dirname, 'scripts', name);
  return path.join(process.resourcesPath, 'scripts', name);
}

// ─── Window Setup ─────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0f',
      symbolColor: '#a78bfa',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── IPC: List All Running Windows & Screens ──────────────────────────────────

ipcMain.handle('get-windows', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 48, height: 48 },
      fetchWindowIcons: true,
    });

    const ourTitle = mainWindow?.getTitle() || 'AutoClicker';
    return sources
      .filter((s) => !s.name.includes(ourTitle) && s.name.trim() !== '')
      .map((s) => ({
        id: s.id,
        name: s.id.startsWith('screen:') ? 'screen' : s.name.split(' - ').pop() || 'app',
        title: s.name,
        handle: s.id,
        icon: s.appIcon ? s.appIcon.toDataURL() : null,
      }));
  } catch (e) {
    console.error('get-windows error:', e);
    return [];
  }
});

// ─── IPC: Capture a Window/Screen Screenshot ─────────────────────────────────

ipcMain.handle('capture-window', async (_event, handle) => {
  console.log(`[capture] Requested handle: ${handle}`);
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenW, height: screenH } = primaryDisplay.bounds;

    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: Math.max(1920, screenW), height: Math.max(1080, screenH) },
    });

    const targetSource = sources.find((s) => s.id === String(handle)) || sources[0];
    if (!targetSource) {
      return { error: 'Window or screen not found' };
    }

    const img = targetSource.thumbnail;
    const base64 = img.toJPEG(85).toString('base64');
    const imgSize = img.getSize();

    windowHandle = handle;
    windowBounds = {
      left: 0,
      top: 0,
      width: screenW,
      height: screenH,
    };
    targetScreen = null;

    console.log(`[capture] Captured ${targetSource.name}: ${imgSize.width}x${imgSize.height}`);

    return {
      screenshot: base64,
      bounds: {
        width: imgSize.width || screenW,
        height: imgSize.height || screenH,
      },
    };
  } catch (e) {
    console.error(`[capture] Error: ${e.message}`);
    return { error: e.message };
  }
});

// ─── IPC: Set Click Target (map image coords → screen coords) ─────────────────

ipcMain.handle('set-click-target', (_event, { imgX, imgY, imgW, imgH }) => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const screenW = primaryDisplay.bounds.width;
  const screenH = primaryDisplay.bounds.height;

  const screenX = Math.round((imgX / imgW) * screenW);
  const screenY = Math.round((imgY / imgH) * screenH);

  targetScreen = { x: screenX, y: screenY };
  console.log(`[target] Target mapped to screen (${screenX}, ${screenY})`);
  return { screenX, screenY };
});

// ─── IPC: Single Test Click ───────────────────────────────────────────────────

ipcMain.handle('do-single-click', async (_event, target) => {
  const t = target || targetScreen;
  if (!t) return { error: 'No target set' };
  try {
    const clickX = t.screenX || t.x;
    const clickY = t.screenY || t.y;
    await runPS(`
      Add-Type @"
using System.Runtime.InteropServices;
public class MC {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);
}
"@
      [MC]::SetCursorPos(${clickX}, ${clickY})
      Start-Sleep -Milliseconds 30
      [MC]::mouse_event(2,0,0,0,0)
      Start-Sleep -Milliseconds 50
      [MC]::mouse_event(4,0,0,0,0)
    `);
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// ─── IPC: Start Auto-Click ────────────────────────────────────────────────────

ipcMain.handle('start-auto-click', (_event, { targets, intervalMs, maxClicks }) => {
  const targetList = targets && targets.length > 0 ? targets : (targetScreen ? [targetScreen] : []);
  if (targetList.length === 0) return { error: 'No targets set' };

  if (autoClickProcess) {
    autoClickProcess.kill();
    autoClickProcess = null;
  }

  const ps1 = scriptPath('auto-click.ps1');
  const targetsJson = JSON.stringify(targetList.map((t, idx) => ({
    x: t.screenX || t.x,
    y: t.screenY || t.y,
    name: t.name || `Target ${idx + 1}`,
    colorDetect: t.colorDetect !== false,
    r: t.r !== undefined ? t.r : null,
    g: t.g !== undefined ? t.g : null,
    b: t.b !== undefined ? t.b : null,
    tolerance: t.tolerance || 95,
  })));

  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', ps1,
    '-TargetsJson', targetsJson,
    '-IntervalMs', String(intervalMs || 500),
    '-MaxClicks', String(maxClicks || 0),
  ];

  autoClickProcess = spawn('powershell', args);

  let buffer = '';
  autoClickProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      const clickMatch = line.match(/^click:(\d+)/);
      if (clickMatch) {
        mainWindow?.webContents.send('click-fired', { count: parseInt(clickMatch[1]) });
      }
      const doneMatch = line.match(/^done:(\d+)/);
      if (doneMatch) {
        autoClickProcess = null;
        mainWindow?.webContents.send('auto-click-stopped', {
          reason: 'max-reached',
          count: parseInt(doneMatch[1]),
        });
      }
    }
  });

  autoClickProcess.on('close', () => {
    if (autoClickProcess) {
      autoClickProcess = null;
      mainWindow?.webContents.send('auto-click-stopped', { reason: 'killed', count: 0 });
    }
  });

  return { started: true };
});

// ─── IPC: Stop Auto-Click ─────────────────────────────────────────────────────

ipcMain.handle('stop-auto-click', () => {
  if (autoClickProcess) {
    autoClickProcess.kill();
    autoClickProcess = null;
  }
  return { stopped: true };
});
