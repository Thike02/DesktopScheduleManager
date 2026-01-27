// 曜日の日本語と英語のマッピング
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayNamesJa = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];

// 今週の日曜日から土曜日までの日付を取得
function getWeekDates() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - dayOfWeek);
  sunday.setHours(0, 0, 0, 0);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + i);
    dates.push(date);
  }
  return dates;
}

// Notionから予定を取得
async function fetchEvents() {
  try {
    const weekDates = getWeekDates();
    const startOfWeek = weekDates[0];
    const endOfWeek = new Date(weekDates[6]);
    endOfWeek.setHours(23, 59, 59, 999);

    const result = await window.notionAPI.fetchEvents({
      startDate: startOfWeek.toISOString().split('T')[0],
      endDate: endOfWeek.toISOString().split('T')[0]
    });

    if (!result.success) {
      // 設定エラーハンドリング
      if (result.error === 'NOTION_TOKEN_MISSING' || result.error === 'DATA_SOURCE_ID_MISSING') {
        document.getElementById('status').textContent = '設定が必要です。右上の⚙️から設定してください。';
        openSettings(); // 設定画面を自動で開く
        return [];
      }
      throw new Error(result.error);
    }

    return processEvents(result.data, weekDates);
  } catch (error) {
    console.error('Error fetching events:', error);
    document.getElementById('status').textContent = 'エラーが発生しました: ' + error.message;
    return [];
  }
}

// イベントデータを処理
function processEvents(results, weekDates) {
  const events = [];

  results.forEach(page => {
    const props = page.properties;
    const name = props.Name?.title?.[0]?.plain_text || '無題';
    const date = props.Date?.date?.start;
    const tags = props.Tag?.multi_select?.map(t => t.name) || [];
    const repeatDay = props['Repeat Day']?.select?.name;
    // ページURLを取得
    const url = page.url;

    if (repeatDay && repeatDay !== 'None') {
      // 繰り返し予定：今週の該当曜日すべてに追加
      const dayIndex = dayNames.indexOf(repeatDay);
      if (dayIndex !== -1) {
        const targetDate = weekDates[dayIndex];
        const time = date ? date.split('T')[1]?.substring(0, 5) : null;

        events.push({
          name,
          date: targetDate,
          time,
          tags,
          url, // URLを追加
          isRecurring: true
        });
      }
    } else if (date) {
      // 通常の予定
      // タイムゾーンによる日付ズレを防ぐため、文字列から直接日付を生成
      const [datePart, timePart] = date.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const eventDate = new Date(year, month - 1, day);
      const time = timePart?.substring(0, 5);

      events.push({
        name,
        date: eventDate,
        time,
        tags,
        url, // URLを追加
        isRecurring: false
      });
    }
  });

  return events;
}

// UIを描画
function renderSchedule(events) {
  const weekDates = getWeekDates();
  const container = document.getElementById('weekContainer');
  container.innerHTML = '';

  weekDates.forEach((date, index) => {
    const dayColumn = document.createElement('div');
    dayColumn.className = 'day-column';

    const header = document.createElement('div');
    header.className = 'day-header';
    
    // 曜日ごとのクラスを追加
    if (index === 0) header.classList.add('sunday');
    if (index === 6) header.classList.add('saturday');

    header.textContent = `${dayNamesJa[index]} ${date.getMonth() + 1}/${date.getDate()}`;
    dayColumn.appendChild(header);

    // その日の予定をフィルタ
    const dayEvents = events.filter(event => {
      return event.date.toDateString() === date.toDateString();
    });

    // 時間順にソート
    dayEvents.sort((a, b) => {
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });

    dayEvents.forEach(event => {
      const card = document.createElement('div');
      card.className = 'event-card';

      if (event.time) {
        const timeDiv = document.createElement('div');
        timeDiv.className = 'event-time';
        timeDiv.textContent = event.time;
        card.appendChild(timeDiv);
      }

      // タイトルをリンク要素として作成
      const titleDiv = document.createElement('a');
      titleDiv.className = 'event-title';
      titleDiv.textContent = event.name;
      // Notionリンクを設定（外部ブラウザで開くように設定が必要な場合がある）
      if (event.url) {
        titleDiv.href = event.url;
        titleDiv.onclick = (e) => {
          e.preventDefault();
          window.open(event.url, '_blank');
        };
      }
      card.appendChild(titleDiv);

      if (event.tags.length > 0) {
        const tagsDiv = document.createElement('div');
        tagsDiv.className = 'event-tags';
        event.tags.forEach(tag => {
          const tagSpan = document.createElement('span');
          tagSpan.className = 'tag';
          tagSpan.textContent = tag;
          tagsDiv.appendChild(tagSpan);
        });
        card.appendChild(tagsDiv);
      }

      dayColumn.appendChild(card);
    });

    container.appendChild(dayColumn);
  });

  document.getElementById('status').textContent = `最終更新: ${new Date().toLocaleTimeString('ja-JP')}`;
}

// 予定を追加
async function addEvent() {
  const name = document.getElementById('eventName').value;
  const dateStr = document.getElementById('eventDate').value;
  const tagsStr = document.getElementById('eventTags').value;
  const repeatDay = document.getElementById('repeatDay').value;

  if (!name || !dateStr) {
    alert('予定名と日時を入力してください');
    return;
  }

  const tags = tagsStr.split(',').map(t => t.trim()).filter(t => t);

  try {
    const result = await window.notionAPI.addEvent({
      name,
      date: dateStr,
      tags,
      repeatDay
    });

    if (!result.success) {
      // 設定エラーハンドリング
      if (result.error === 'NOTION_TOKEN_MISSING') {
        alert('Notion設定がされていません。');
        openSettings();
        return;
      }
      throw new Error(result.error);
    }

    alert('予定を追加しました');

    // フォームをクリア
    document.getElementById('eventName').value = '';
    document.getElementById('eventDate').value = '';
    document.getElementById('eventTags').value = '';
    document.getElementById('repeatDay').value = 'None';

    // 再読み込み
    await loadSchedule();
  } catch (error) {
    console.error('Error adding event:', error);
    alert('予定の追加に失敗しました: ' + error.message);
  }
}

// スケジュールを読み込み
async function loadSchedule() {
  const events = await fetchEvents();
  renderSchedule(events);
}

// 設定モーダル関連の処理
async function openSettings() {
  const modal = document.getElementById('settingsModal');
  modal.style.display = 'flex';
  
  const settings = await window.notionAPI.getSettings();
  document.getElementById('settingToken').value = settings.NOTION_TOKEN || '';
  document.getElementById('settingDatabaseId').value = settings.NOTION_DATABASE_ID || '';
  document.getElementById('settingDataSourceId').value = settings.NOTION_DATA_SOURCE_ID || '';
}

function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none';
}

async function saveSettings() {
  const token = document.getElementById('settingToken').value.trim();
  const dbId = document.getElementById('settingDatabaseId').value.trim();
  const dsId = document.getElementById('settingDataSourceId').value.trim();

  await window.notionAPI.saveSettings({
    NOTION_TOKEN: token,
    NOTION_DATABASE_ID: dbId,
    NOTION_DATA_SOURCE_ID: dsId
  });

  closeSettings();
  loadSchedule();
}

// 入力フォームの表示・非表示を切り替える
function toggleForm() {
  const form = document.getElementById('addEventForm');
  const btn = document.getElementById('toggleFormBtn');
  
  if (form.style.display === 'none' || form.style.display === '') {
    form.style.display = 'block';
    btn.textContent = '- 閉じる';
  } else {
    form.style.display = 'none';
    btn.textContent = '+ 予定を追加';
  }
}

// アプリを再読み込み
function reloadApp() {
  window.location.reload();
}

// 初回読み込みと定期更新（1時間ごと）
loadSchedule();
setInterval(loadSchedule, 60 * 60 * 1000);