# ⚡ AutoClicker

A high-performance visual auto-clicker desktop application built with **Electron + React + Vite**.

Designed specifically for automated gaming, web tasks, and AFK farming (such as WebGL games like Hazmob FPS on CrazyGames).

## ✨ Key Features

- **🎯 Multi-Target Button Selection**: Add and configure multiple target buttons simultaneously (e.g. Upgrade button + Continue Playing popups).
- **🧠 Smart Visual Color Detection**: Samples the exact pixel color of each target button and only clicks when that button is actively visible on the screen. No unwanted clicks or cursor jumping between screens!
- **🖥️ Native Window & Screen Capture**: High-speed, high-resolution capture of any hardware-accelerated 3D window, WebGL game, or entire display.
- **⚡ Individual Button Testing**: Test-fire any single target button with one click to verify coordinate accuracy.
- **⏱️ Configurable Timing**: Custom interval (ms) and optional max click limit (`0` for unlimited).

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the App
```bash
npm run dev
```

## 🎮 How to Use

1. **Select Window / Screen**: Choose your game window (or "Entire Screen") from the sidebar list.
2. **Add Targets**:
   - Click **+ Add Target Button** (or **🎯 Select**).
   - Click directly on the target button in the live preview.
   - Repeat for any popups (e.g. "Continue Playing").
3. **Configure**: Keep **"Click only when visible"** checked for smart color-matching.
4. **Run**: Click **▶ Start Auto-Clicking** to begin automated clicking!

