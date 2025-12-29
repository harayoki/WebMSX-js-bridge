# HuggingFace Space 向けサンプル

`app.py` と最小限の HTML サンプルをまとめたフォルダーです。HuggingFace Spaces の **Docker ではない** Python スペースにそのまま配置することを想定しています。

## 使い方

1. スペースにこのフォルダーの内容をコピーし、`requirements.txt` をスペースのルートに置きます。
2. `app.py` をエントリーポイントにして起動してください。
   ```bash
   uvicorn app:app --host 0.0.0.0 --port 7860
   ```
3. ルートページにアクセスするとサンプルを選ぶドロップダウンが表示されます。「別ページで開く」を押すと、新しいタブで `player.html` が開き、選択したサンプル HTML が iframe で全画面表示されます。
4. スマホでは新しいタブをホーム画面に追加すると、ブラウザ UI を隠した全画面モードで利用できます。

## サンプル一覧

- `bridge-sample.html` — WebMSX の I/O ポートに値を書き込む最小例。`WMSX.room.bus.writePort` が利用できる前提です。
- `fullscreen-panel.html` — モバイル向けの全画面 UI の骨組みだけを示したサンプル。

サンプルを追加したい場合は `samples/` に HTML を置き、`app.py` の `SAMPLES` 辞書にエントリを追記してください。
