const { app, BrowserWindow, ipcMain, Notification, Menu, Tray } = require('electron');
const path = require('path');
const { Client } = require('@notionhq/client');
const fs = require('fs');

let notion;
let store;
let mainWindow;
let tray = null;
let isQuitting = false;

// 多重起動の防止
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // 二重起動しようとした時に、隠れているウィンドウを表示させる
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  function initNotion() {
    if (!store) return;
    const token = store.get('NOTION_TOKEN');
    if (token) {
      notion = new Client({ auth: token });
    }
  }

  // ローカル時間で YYYY-MM-DD 形式を取得する関数（日付ズレ防止）
  function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      frame: false, // ウィンドウ枠を削除
      icon: path.join(__dirname, 'icon.png'), // ウィンドウ用アイコン
      skipTaskbar: true, // 起動時からタスクバーに表示しない
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    Menu.setApplicationMenu(null);
    mainWindow.loadFile('index.html');

    // ウィンドウを閉じる動作を「トレイへの格納」に変更
    mainWindow.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault();
        mainWindow.hide();
        mainWindow.setSkipTaskbar(true); // 隠蔽時はタスクバーから確実に非表示
      }
    });

    // 再表示時もタスクバーには出さない
    mainWindow.on('show', () => {
      mainWindow.setSkipTaskbar(true);
    });
  }

  // 常駐用システムトレイの作成
  function createTray() {
    // ビルド後は resources フォルダ内の .icon-ico を参照、開発時は直下の icon.png を参照
    const iconPath = app.isPackaged 
      ? path.join(process.resourcesPath, '.icon-ico', 'icon.ico')
      : path.join(__dirname, 'icon.png');
    
    if (fs.existsSync(iconPath)) {
      tray = new Tray(iconPath);

      const contextMenu = Menu.buildFromTemplate([
        { label: '表示', click: () => mainWindow.show() },
        { type: 'separator' },
        { label: '完全に終了', click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ]);

      tray.setToolTip('週間スケジュール');
      tray.setContextMenu(contextMenu);

      tray.on('click', () => {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      });
    } else {
      console.warn('Tray icon not found at: ' + iconPath);
    }
  }

  ipcMain.handle('get-settings', () => {
    return {
      NOTION_TOKEN: store.get('NOTION_TOKEN') || '',
      NOTION_DATABASE_ID: store.get('NOTION_DATABASE_ID') || '',
      NOTION_DATA_SOURCE_ID: store.get('NOTION_DATA_SOURCE_ID') || ''
    };
  });

  ipcMain.handle('save-settings', (event, settings) => {
    store.set('NOTION_TOKEN', settings.NOTION_TOKEN);
    store.set('NOTION_DATABASE_ID', settings.NOTION_DATABASE_ID);
    store.set('NOTION_DATA_SOURCE_ID', settings.NOTION_DATA_SOURCE_ID);
    initNotion();
    return { success: true };
  });

  ipcMain.handle('fetch-events', async (event, { startDate, endDate }) => {
    if (!notion) return { success: false, error: 'NOTION_TOKEN_MISSING' };
    const dataSourceId = store.get('NOTION_DATA_SOURCE_ID');
    if (!dataSourceId) return { success: false, error: 'DATA_SOURCE_ID_MISSING' };

    try {
      const response = await notion.dataSources.query({
        data_source_id: dataSourceId,
        filter: {
          or: [
            {
              property: 'Date',
              date: { on_or_after: startDate, on_or_before: endDate }
            },
            {
              property: 'Repeat Day',
              select: { is_not_empty: true }
            }
          ]
        }
      });
      return { success: true, data: response.results };
    } catch (error) {
      console.error('Error fetching events:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('add-event', async (event, eventData) => {
    if (!notion) return { success: false, error: 'NOTION_TOKEN_MISSING' };
    const databaseId = store.get('NOTION_DATABASE_ID');
    if (!databaseId) return { success: false, error: 'DATABASE_ID_MISSING' };

    try {
      const properties = {
        Name: { title: [{ text: { content: eventData.name } }] },
        Date: { date: { start: eventData.date } },
        Tag: { multi_select: eventData.tags.map(tag => ({ name: tag })) }
      };

      if (eventData.repeatDay && eventData.repeatDay !== 'None') {
        properties['Repeat Day'] = { select: { name: eventData.repeatDay } };
      }

      await notion.pages.create({
        parent: { database_id: databaseId },
        properties: properties
      });
      return { success: true };
    } catch (error) {
      console.error('Error adding event:', error);
      return { success: false, error: error.message };
    }
  });

  app.whenReady().then(async () => {
    const { default: Store } = await import('electron-store');
    store = new Store();
    initNotion();

    createWindow();
    createTray();
    setupDailyReminder();

    // PC起動時の自動実行設定（ビルド済みexeでのみ動作）
    if (app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: app.getPath('exe')
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      // 常駐のため終了させない
    }
  });

  // 毎日23時のリマインダー設定
  function setupDailyReminder() {
    function getTimeUntilTarget() {
      const now = new Date();
      const target = new Date();
      target.setHours(23, 0, 0, 0);
      if (now >= target) {
        target.setDate(target.getDate() + 1);
      }
      return target.getTime() - now.getTime();
    }
    
    setTimeout(() => {
      sendTomorrowReminder();
      setInterval(sendTomorrowReminder, 24 * 60 * 60 * 1000);
    }, getTimeUntilTarget());
  }

  // 翌日の予定をリマインド
  async function sendTomorrowReminder() {
    if (!notion || !store) return;
    const dataSourceId = store.get('NOTION_DATA_SOURCE_ID');
    if (!dataSourceId) return;

    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const dateStr = getLocalDateString(tomorrow);
      const dayName = getDayName(tomorrow.getDay());
      
      const response = await notion.dataSources.query({
        data_source_id: dataSourceId,
        filter: {
          or: [
            { property: 'Date', date: { equals: dateStr } },
            { property: 'Repeat Day', select: { equals: dayName } }
          ]
        },
        sorts: [{ property: 'Date', direction: 'ascending' }]
      });
      
      const events = response.results;
      if (events.length === 0) return;
      
      let message = '';
      events.forEach((event, index) => {
        if (index < 5) {
          const name = event.properties.Name?.title?.[0]?.plain_text || '無題';
          const date = event.properties.Date?.date?.start;
          const time = date && date.includes('T') ? date.split('T')[1]?.substring(0, 5) : '';
          message += `${time ? time + ' ' : ''}${name}\n`;
        }
      });
      
      if (events.length > 5) {
        message += `...他 ${events.length - 5} 件`;
      }
      
      showNotification(`明日の予定 (${events.length}件)`, message);
    } catch (error) {
      console.error('Error sending reminder:', error);
    }
  }

  function getDayName(dayIndex) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayIndex];
  }

  function showNotification(title, body) {
    if (Notification.isSupported()) {
      const notification = new Notification({ title: title, body: body });
      notification.show();
    }
  }
}