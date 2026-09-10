# 泉大津チャレンジ エンジョイランキングシステム

走行結果CSVを読み込み、午前コース・午後コース・体験コースごとに、ゼッケン別の上位3件を表示するWindowsアプリです。

## ダウンロード

[最新版をダウンロード](https://github.com/yoshinsk/izumiotsuChallenge/releases/latest/download/izumiotsu-ranking-latest.exe)

インストーラーは不要です。ダウンロードしたexeをそのまま起動してください。

## 操作

1. `選択` で走行結果CSVを指定します。
2. StartTime/FinishTimeで午前・午後を分ける場合は `時刻で自動判定` を押します。
3. 時刻で分けられない場合は、午前終了時点で `午前CSVとして登録` を押します。
4. 午後終了時点では、午前と午後が入った累積CSVを選び、`午後CSV(累積)として登録` を押します。
5. 体験コースは `体験コースゼッケン` の範囲指定で判定します。初期値は `M1-M999,900-999` です。
6. 必要に応じて `ランキングCSVを保存` で表示中のランキングをCSV出力します。

## 集計ルール

- ベストラップ: ゼッケンごとの最短 `TotalLapTime` を上位とします。表示は `LapTimeString` を使います。
- ワーストラップ & ベストとの差: ゼッケンごとの `最遅TotalLapTime - 最短TotalLapTime` が大きい順です。初期設定では `MissCourseCount` がある走行を除外します。
- ミスコース総数: `MissCourseCount + FourWheelOffCourseCount` を合算します。
- パイロンタッチ総数: `PylonTouchCount` を合算します。
- 脱輪総数: `TwoWheelOffCourseCount` を合算します。

## 開発

計測担当PCでの利用に、Python、.NET、Node.js、npmは不要です。

開発PCでビルドする場合のみ、Node.jsとnpmを使用します。

```powershell
npm install
npm run dist:win
```

生成物は `release` フォルダに作成されます。

## 検証

```powershell
npm test
```

## ライセンス

MIT Licenseです。商用・非商用を問わず利用できます。
