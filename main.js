const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('@notionhq/client');

// exe化された場合でも.envを読み込めるようにパスを設定
const envPath = app.isPackaged
  ? path.join(path.dirname(app.getPath('exe')), '.env')
  : path.join(__dirname, '.env');

dotenv.config({ path: envPath });

let notion;
let store;

function initNotion() {
  if (!store) return;
  const token = store.get('NOTION_TOKEN') || process.env.NOTION_TOKEN;
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
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile('index.html');
}

ipcMain.handle('get-settings', () => {
  return {
    NOTION_TOKEN: store.get('NOTION_TOKEN') || process.env.NOTION_TOKEN || '',
    NOTION_DATABASE_ID: store.get('NOTION_DATABASE_ID') || process.env.NOTION_DATABASE_ID || '',
    NOTION_DATA_SOURCE_ID: store.get('NOTION_DATA_SOURCE_ID') || process.env.NOTION_DATA_SOURCE_ID || ''
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
  const dataSourceId = store.get('NOTION_DATA_SOURCE_ID') || process.env.NOTION_DATA_SOURCE_ID;
  if (!dataSourceId) return { success: false, error: 'DATA_SOURCE_ID_MISSING' };

  try {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        or: [
          {
            property: 'Date',
            date: {
              on_or_after: startDate,
              on_or_before: endDate
            }
          },
          {
            property: 'Repeat Day',
            select: {
              is_not_empty: true
            }
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
  const databaseId = store.get('NOTION_DATABASE_ID') || process.env.NOTION_DATABASE_ID;
  if (!databaseId) return { success: false, error: 'DATABASE_ID_MISSING' };

  try {
    const properties = {
      Name: {
        title: [{ text: { content: eventData.name } }]
      },
      Date: {
        date: { start: eventData.date }
      },
      Tag: {
        multi_select: eventData.tags.map(tag => ({ name: tag }))
      }
    };

    if (eventData.repeatDay && eventData.repeatDay !== 'None') {
      properties['Repeat Day'] = {
        select: { name: eventData.repeatDay }
      };
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
  setupDailyReminder();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 毎日23時のリマインダー設定
function setupDailyReminder() {
  function getTimeUntilTarget() {
    const now = new Date();
    const target = new Date();
    
    // 毎日 23:00 に設定
    target.setHours(23, 0, 0, 0);
    
    // すでに23時を過ぎている場合は、翌日の23時にセット
    if (now >= target) {
      target.setDate(target.getDate() + 1);
    }
    
    return target.getTime() - now.getTime();
  }
  
  // 初回実行
  setTimeout(() => {
    sendTomorrowReminder();
    // 以降、24時間ごとに実行
    setInterval(sendTomorrowReminder, 24 * 60 * 60 * 1000);
  }, getTimeUntilTarget());
  
  console.log(`Next reminder in ${Math.round(getTimeUntilTarget() / 1000 / 60)} minutes`);
}

// 翌日の予定をリマインド
async function sendTomorrowReminder() {
  if (!notion || !store) return;
  const dataSourceId = store.get('NOTION_DATA_SOURCE_ID') || process.env.NOTION_DATA_SOURCE_ID;
  if (!dataSourceId) return;

  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1); // 明日の日付に設定
    tomorrow.setHours(0, 0, 0, 0);

    const dateStr = getLocalDateString(tomorrow); // ローカル時間での日付文字列 (YYYY-MM-DD)
    const dayName = getDayName(tomorrow.getDay());
    
    console.log(`Fetching events for: ${dateStr} (${dayName})`);
    
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        or: [
          {
            property: 'Date',
            date: {
              equals: dateStr // 指定した1日（明日）と一致するもの
            }
          },
          {
            property: 'Repeat Day', // 曜日指定の繰り返し予定
            select: {
              equals: dayName
            }
          }
        ]
      },
      sorts: [
        {
          property: 'Date',
          direction: 'ascending'
        }
      ]
    });
    
    const events = response.results;
    
    if (events.length === 0) {
      // 予定がない場合もログには出す
      console.log('明日の予定はありません');
      return;
    }
    
    let message = '';
    events.forEach((event, index) => {
      if (index < 5) {
        const name = event.properties.Name?.title?.[0]?.plain_text || '無題';
        const date = event.properties.Date?.date?.start;
        // 時間がある場合(Tが含まれる)のみ時間を抽出
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
    const notification = new Notification({
      title: title,
      body: body
    });
    notification.show();
  }
}