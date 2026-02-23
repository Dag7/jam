import { ipcMain, type BrowserWindow } from 'electron';

export function registerWindowHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('window:minimize', () => getWindow()?.minimize());
  ipcMain.handle('window:close', () => getWindow()?.hide());
  ipcMain.handle('window:maximize', () => {
    const win = getWindow();
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  // Compact mode — save/restore window bounds
  let savedBounds: Electron.Rectangle | null = null;

  ipcMain.handle('window:setCompact', (_, compact: boolean) => {
    const win = getWindow();
    if (!win) return;

    if (compact) {
      savedBounds = win.getBounds();
      const { x, y, width } = savedBounds;
      const compactHeight = 90;
      const compactWidth = Math.min(width, 700);
      win.setMinimumSize(300, compactHeight);
      win.setBounds({ x, y, width: compactWidth, height: compactHeight }, true);
      win.setAlwaysOnTop(true, 'floating');
    } else {
      win.setAlwaysOnTop(false);
      win.setMinimumSize(640, 480);
      if (savedBounds) {
        win.setBounds(savedBounds, true);
        savedBounds = null;
      }
    }
  });
}
