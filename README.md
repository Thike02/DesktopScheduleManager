# DesktopScheduleManager
Desktopに表示できる日常のタスクマネージャーです

Notionのデータベースと連携し、日々の予定を管理・通知します。特に「翌日の予定」を夜のうちに確認することに特化しており、毎晩23時に自動でリマインダー通知を行います。

## 主な機能

* **Notion連携**: 指定したNotionデータベースから自動で予定を取得。
* **翌日リマインダー**: 毎日23:00に、明日の予定をデスクトップ通知でお知らせします。
* **常駐機能**: アプリはバックグラウンドで動作し、邪魔になりません。

---

## 利用開始までの手順 (For Users)

本アプリを使用するには、Notion側の準備と設定ファイルの配置が必要です。

### Step 1: Notionの準備

まず、予定を管理するためのNotionデータベースを用意します。

1.  Notionで新しいデータベースを作成し、以下のプロパティを正確に設定してください。

    | プロパティ名 | 種類 (Type) | 説明 |
    | :--- | :--- | :--- |
    | **Name** | タイトル (Title) | 予定の名称 |
    | **Date** | 日付 (Date) | 予定の日時 |
    | **Tag** | マルチセレクト | タグ（任意） |
    | **Repeat Day** | セレクト (Select) | 毎週繰り返す場合の曜日指定 |

    > **⚠️ Repeat Dayの設定について**
    > セレクトの選択肢には、必ず **英語の曜日名** (`Monday`, `Tuesday`, ... `Sunday`) を作成してください。

2.  [Notion My Integrations](https://www.notion.so/my-integrations) で新しいインテグレーションを作成し、**「内部インテグレーションシークレット」** を取得します。
3.  作成したデータベースのメニュー「...」→「接続 (Connect to)」から、作成したインテグレーションを追加してアクセスを許可します。

### Step 2: インストール

1.  [Releases](../../releases) ページから最新のインストーラー (`Setup.exe`) をダウンロードします。
2.  インストーラーを実行し、アプリをインストールします。

### Step 3: 設定ファイル (.env) の配置 【重要】

セキュリティのため、アプリにはAPIキーが含まれていません。以下の手順で設定ファイルを配置してください。

1.  メモ帳などのテキストエディタを開き、以下の内容をコピーして貼り付けます。

    ```ini
    NOTION_TOKEN=ここにインテグレーションシークレットを貼り付け
    NOTION_DATABASE_ID=ここにデータベースIDを貼り付け
    NOTION_DATA_SOURCE_ID=ここにデータソースIDを貼り付け
    ```

2.  それぞれの値を、Step 1で取得したご自身のNotionの情報に書き換えます。
3.  ファイルを **`.env`** という名前で保存します（拡張子は不要です）。
4.  この `.env` ファイルを、アプリのインストール先フォルダの中に移動します。
    * **標準的なインストール先:**
        `C:\Users\{あなたのユーザー名}\AppData\Local\Programs\notion-schedule-app`
        （または `DesktopScheduleManager` 等、設定したProduct Nameによります）
5.  アプリを再起動すると、連携が開始されます。

---

## 開発とビルド (For Developers)

ソースコードから開発、または自分でexeをビルドする場合の手順です。

### 前提条件
* Node.js がインストールされていること

### セットアップ

```bash
# リポジトリのクローン
git clone [https://github.com/yourname/DesktopScheduleManager.git](https://github.com/yourname/DesktopScheduleManager.git)

# 依存パッケージのインストール
npm install