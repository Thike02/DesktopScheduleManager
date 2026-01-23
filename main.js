require('dotenv').config();

const { app, BrowserWindow, ipcMain } = require('electron');
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