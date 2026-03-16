/**
 * Agent sandbox Dockerfile content + extra build context files.
 *
 * Exported as string constants so consumers don't need to resolve
 * file paths at runtime — works reliably in bundled environments.
 *
 * Keep in sync with `packages/sandbox/docker/Dockerfile` (the canonical copy).
 */
export const AGENT_DOCKERFILE = `FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# System essentials
RUN apt-get update && apt-get install -y \\
  curl wget git build-essential python3 python3-pip python3-venv \\
  ca-certificates gnupg lsof net-tools jq unzip sudo \\
  && rm -rf /var/lib/apt/lists/*

# Node.js 22 (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \\
  && apt-get install -y nodejs \\
  && rm -rf /var/lib/apt/lists/*

# Common Node.js global tools
RUN npm install -g yarn pnpm tsx

# --- Agent Runtimes ---

# 1. Claude Code (npm)
RUN npm install -g @anthropic-ai/claude-code

# 2. Codex CLI (npm)
RUN npm install -g @openai/codex

# 3. OpenCode (Go binary via install script)
RUN curl -fsSL https://opencode.ai/install | bash \\
  && mv /root/.local/bin/opencode /usr/local/bin/opencode 2>/dev/null || true

# 4. Cursor Agent (Go binary via install script)
RUN curl -fsSL https://cursor.com/install | bash \\
  && mv /root/.local/bin/cursor-agent /usr/local/bin/cursor-agent 2>/dev/null || true

# --- Virtual Desktop (for computer-use agents) ---

# Display server, window manager, VNC, input tools, screenshot
RUN apt-get update && apt-get install -y --no-install-recommends \\
  xvfb \\
  fluxbox \\
  x11vnc \\
  xdotool \\
  wmctrl \\
  scrot \\
  imagemagick \\
  libxss1 \\
  libx11-xcb1 \\
  xterm \\
  dbus-x11 \\
  x11-utils \\
  x11-xserver-utils \\
  feh \\
  && rm -rf /var/lib/apt/lists/*

# noVNC (web-based VNC viewer for dashboard)
RUN git clone --depth 1 https://github.com/novnc/noVNC /opt/noVNC && \\
  git clone --depth 1 https://github.com/novnc/websockify /opt/noVNC/utils/websockify && \\
  ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html

# Computer-use server (copied from build context by ImageManager)
COPY computer-use/ /opt/computer-use/
RUN cd /opt/computer-use && npm install --production 2>/dev/null || true

# Playwright + its bundled Chromium (Ubuntu 24.04 snap chromium doesn't work in Docker)
# Shared browser path so both root (build) and agent (runtime) can find it
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN cd /opt/computer-use && npm install playwright \\
  && npx playwright install chromium --with-deps \\
  && chmod -R o+rx /opt/pw-browsers

# Desktop startup script (copied from build context by ImageManager)
COPY start-desktop.sh /usr/local/bin/start-desktop.sh
RUN chmod +x /usr/local/bin/start-desktop.sh

# Create non-root agent user (Claude Code refuses --dangerously-skip-permissions as root)
# Restricted sudo: only package managers — no arbitrary root commands
RUN useradd -m -s /bin/bash -G sudo agent \\
  && echo "agent ALL=(root) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /usr/bin/npm, /usr/bin/pip3" \\
  >> /etc/sudoers.d/agent \\
  && chmod 0440 /etc/sudoers.d/agent

# Working directory
WORKDIR /workspace
RUN chown agent:agent /workspace

USER agent

# Jam CLI tool (mounted from host at runtime) — add to PATH
ENV PATH="/home/agent/.jam/bin:\${PATH}"

# Default command: idle process (container stays alive, commands via docker exec)
# Desktop agents override this with start-desktop.sh
CMD ["sleep", "infinity"]
`;

/** Desktop startup script — starts Xvfb, fluxbox, VNC, noVNC, and computer-use server */
export const DESKTOP_STARTUP_SCRIPT = `#!/bin/bash
set -e

RESOLUTION="\${SCREEN_RESOLUTION:-1920x1080}"
DISPLAY_NUM="\${DISPLAY:-:99}"
COMPUTER_USE_PORT="\${COMPUTER_USE_PORT:-3100}"

# Fix named volume ownership (Docker creates them as root)
sudo chown -R agent:agent /home/agent/.cache /home/agent/.local /home/agent/.config 2>/dev/null || true

echo "[desktop] Starting virtual desktop at \${RESOLUTION} on display \${DISPLAY_NUM}"

# Start virtual framebuffer
Xvfb \${DISPLAY_NUM} -screen 0 \${RESOLUTION}x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
export DISPLAY=\${DISPLAY_NUM}

# Wait for X server
for i in $(seq 1 30); do
  if xdpyinfo -display \${DISPLAY_NUM} >/dev/null 2>&1; then
    echo "[desktop] X server ready"
    break
  fi
  sleep 0.2
done

# Configure fluxbox to use feh for wallpaper (fbsetbg auto-detects it)
mkdir -p ~/.fluxbox
echo "feh" > ~/.fluxbox/lastwallpaper 2>/dev/null || true

# Start window manager
fluxbox &
sleep 0.5

# Set wallpaper with feh (the Ubuntu/fluxbox wallpaper, or solid color as fallback)
if [ -f /usr/share/images/fluxbox/ubuntu-light.png ]; then
  feh --bg-scale /usr/share/images/fluxbox/ubuntu-light.png 2>/dev/null || xsetroot -solid "#1a1a2e" 2>/dev/null || true
else
  xsetroot -solid "#1a1a2e" 2>/dev/null || true
fi

# Dismiss any stale dialogs
wmctrl -c xmessage 2>/dev/null || true

# VNC server (no password — container-internal only)
x11vnc -display \${DISPLAY_NUM} -nopw -listen 0.0.0.0 -rfbport 5900 -shared -forever -noxdamage &

# noVNC web client
/opt/noVNC/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &

# Computer-use HTTP server
cd /opt/computer-use
npx tsx src/cli.ts --port \${COMPUTER_USE_PORT} --display \${DISPLAY_NUM} &
CU_PID=$!

for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:\${COMPUTER_USE_PORT}/status >/dev/null 2>&1; then
    echo "[desktop] Computer-use server ready on port \${COMPUTER_USE_PORT}"
    break
  fi
  sleep 0.5
done

echo "[desktop] All desktop services started"

trap "kill $XVFB_PID $CU_PID 2>/dev/null; exit 0" SIGTERM SIGINT
wait $XVFB_PID
`;
