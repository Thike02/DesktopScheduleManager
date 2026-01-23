require('dotenv').config();

const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const { Client } = require('@notionhq/client');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID;

if (!NOTION_TOKEN || !DATABASE_ID || !DATA_SOURCE_ID) {
  console.error('Error: .env file is missing required variables.');
  process.exit(1);
}

const notion = new Client({
  auth: NOTION_TOKEN
});

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

ipcMain.handle('fetch-events', async (event, { startDate, endDate }) => {
  try {
    const response = await notion.dataSources.query({
      data_source_id: DATA_SOURCE_ID,
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
      parent: { database_id: DATABASE_ID },
      properties: properties
    });

    return { success: true };
  } catch (error) {
    console.error('Error adding event:', error);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
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
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1); // 明日の日付に設定
    tomorrow.setHours(0, 0, 0, 0);

    const dateStr = getLocalDateString(tomorrow); // ローカル時間での日付文字列 (YYYY-MM-DD)
    const dayName = getDayName(tomorrow.getDay());
    
    console.log(`Fetching events for: ${dateStr} (${dayName})`);
    
    const response = await notion.dataSources.query({
      data_source_id: DATA_SOURCE_ID,
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
      // 予定がない場合もログには出す（通知はウザいかもしれないのでコメントアウト）
      console.log('明日の予定はありません');
      // showNotification('明日の予定', '明日は予定がありません');
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