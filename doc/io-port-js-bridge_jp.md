# IOポートJSブリッジ

## 概要

本ドキュメントでは、**WebMSX** 内で **I/Oポート** を使ってJavaScriptコードとMSX側コードを接続する仕組みを説明します。

通信をMSX標準のI/Oポートアクセスに限定することで、WebMSX上で動作するプログラムがJavaScript経由で外部とやり取りできます。この方針により、Web固有のロジックをエミュレータコアやMSXプログラムに直接埋め込むことを避けます。

この仕組みはデフォルトでは **WebMSXエミュレータ内のみで動作** します。ただし、同じI/Oポートアクセスをフックして処理する実機MSX向けカートリッジを設計すれば、外部ハードウェアの能力次第で実機でも似た概念を実現できます。

長期的な目的は、MSXプログラムのロジックをクリーンかつ移植性の高い状態に保ちつつ、将来の専用ROMカートリッジ実装の余地を残すことです。

---

## 設計哲学

- 通信は **I/Oポート経由のみ** で行う
- MSXプログラムに直接Web APIを公開しない
- JavaScriptはMSX OSの一部ではなく外部環境として扱う
- MSX側コードは正当なZ80/MSXソフトウェアのままにする
- エミュレータ固有の挙動はI/O境界に隔離する

この設計により、エミュレータやMSXソフトへWebアクセスをハードコードすることを避け、将来のハードウェア実装の可能性を維持します。

---

## 通信モデル

- **MSX → JS**
  - MSX側は `OUT` 命令でデータを送信
- **JS → MSX**
  - MSX側は `IN` 命令でデータを受信
- データはバイト列として転送
- より高レベルのプロトコル（長さ付きデータ、コマンド、JSONなど）はこのバイトストリーム上に構築

---

## 実現できる例

### BGM / 効果音再生

- JavaScriptが音声再生（例：MP3、ストリーミング音声）を担当
- MSX側は次のようなコマンドを送る:
  - 再生 / 停止
  - トラックID
  - 音量変更

カートリッジ側での音声処理仕様については [サウンドカートリッジ仕様](sound-cartridge-spec_jp.md) を参照してください。

将来のハードウェア案では、ROMカートリッジが以下を行うことが想定されます:
- 外部にMP3や圧縮音声データを格納
- オンボードチップでデコード
- デコードした音声をMSXの音声出力にミックス

これにより、MSX1クラスのマシンでもリッチなストリーミング音声が可能になります。

---

### Webページ遷移やDOM制御

- JavaScriptがDOM更新やページ遷移を実施
- 典型的な利用例:
  - ゲームクリア時の演出
  - シーン遷移
  - エミュレータキャンバス外のUI更新

MSXプログラムはWeb環境を意識せず、I/O経由でコマンドを出すだけです。

---

### インターネットデータへのアクセス

- JavaScriptがインターネットから動的データを取得
  - API
  - オンラインサービス
  - リモート設定やスコア
- 取得したデータをI/Oブリッジ経由でMSX側へ返送

これにより、MSXソフトは自前のネットワークスタックを持たずに外部データへ反応できます。

---

### タッチやジェスチャ入力

- JavaScriptがスマホ/タブレットの操作を検出
  - タッチ座標
  - スワイプ方向
  - ジェスチャ種別
- イベントをエンコードし、I/Oポート経由でMSXへ送信

MSX側のロジックをシンプルかつデバイス非依存のままに、最新の入力手段を利用できます。

---

## 制限事項

- 専用ハードウェアがない限り、この仕組みはWebMSX内でのみ機能
- 性能はI/Oポーリング頻度とプロトコル設計に依存
- タイミングに厳しい処理はMSX側に残すべき

---

## まとめ

I/OポートJSブリッジは、JavaScriptを統合ランタイムではなく外部周辺機器として扱います。MSX時代のI/Oセマンティクスを尊重することで、移植性とシンプルさ、そして将来の実機ハードウェア実装の可能性を保ちつつ、現代的な機能を提供します。

---

## エミュレータ外JavaScriptでOUT/INを扱う実装指針

### いつフックするか
- `WMSX.start()` 呼び出し後は `WMSX.room.machine.bus` にアクセスできる。
- ポートを占有する前に、`bus.devicesInputPorts` / `bus.devicesOutputPorts` を確認し、既存デバイスが無いことを必ず確認する。

### OUT（MSX → JS）処理
- `bus.connectOutputDevice(port, handler)` でハンドラを登録する。ハンドラは `(value, port)` を受ける。
- ハンドラ内では**即時に重い処理をしない**。キューに積んで `setTimeout` / `queueMicrotask` などで後続処理を行い、エミュレータのフレームをブロックしない。
- 例: OUTで渡されたバイト列をまとめてホストJS側へ転送する。

```js
function attachBridge() {
  const bus = WMSX.room.machine.bus;
  const PORT_DATA = 0x48;   // 使用前に空きポートであることを要確認
  const outbox = [];

  function drainOutbox() {
    if (!outbox.length) return;
    const packet = new Uint8Array(outbox.splice(0, outbox.length));
    // ここでfetchやWebSocket送信などを実施
  }

  bus.connectOutputDevice(PORT_DATA, (value) => {
    outbox.push(value & 0xff);
    if (outbox.length === 1) queueMicrotask(drainOutbox);
  });
}
```

### IN（JS → MSX）処理
- `bus.connectInputDevice(port, handler)` でハンドラを登録する。ハンドラは `port` を受け、**即時にバイト値を返す必要**がある。
- 非同期データを渡す場合はあらかじめキューを用意し、無い場合は `0xff` 等の「未準備」を表す値を返す。
- OUTとINを分けた「データポート」と「ステータスポート」を設けるとプロトコル設計が単純になる。

```js
function attachInbound(bus) {
  const PORT_STATUS = 0x49; // 使用前に空きポートであることを確認
  const PORT_DATA = 0x4a;
  const inbox = [];

  // 外部イベントでinboxにpushする
  function feedBytes(bytes) { inbox.push(...bytes); }

  bus.connectInputDevice(PORT_STATUS, () => (inbox.length ? 1 : 0)); // 1=読めるデータあり
  bus.connectInputDevice(PORT_DATA, () => (inbox.length ? inbox.shift() : 0xff));
}
```

### ポート設計のコツ
- 既存デバイスが使用するポートを避ける（VDP: 0x98–0x9b、PSG: 0xa0–0xa1、PPI: 0xa8–0xab など）。
- 2〜4ポートを連番で確保し、「データ」「ステータス」「コマンド/長さ」といった役割を分離する。
- 大量転送が必要な場合は「長さ付きパケット」「先頭バイトをコマンド」といったシンプルな自前プロトコルを組む。

### クリーンアップ
- ブリッジを外すときは `bus.disconnectInputDevice` / `bus.disconnectOutputDevice` を呼び出してポートを解放する。
- NetPlayなどでRoomが再構成される場合は、再度 `attachBridge` を呼び出して新しい `bus` に繋ぎ直す。
