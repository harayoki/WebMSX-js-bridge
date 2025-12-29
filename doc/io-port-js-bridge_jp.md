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

## Short Protocol v1-2P（2ポート短縮版）

**目的:** 旧4ポート版の思想（STATUSビット、TYPE/LEN/PAYLOADパケット、RESET、BUSY/ERROR）を保ったまま、固定ポート`0x48/0x49`の2ポートに圧縮する。

### ポート割り当て
- **PORT0 = `0x48` (CTRL/STATUS、双方向)**
  - `OUT`: `CMD`（1バイト）
  - `IN` : `STATUS`（ビットフィールド）
- **PORT1 = `0x49` (DATA、双方向)**
  - `OUT`: `ARG` / `DATA`（1バイトずつ）
  - `IN` : RXデータ（1バイトずつ、JS側リングバッファから）

### STATUSビット（`IN PORT0`）
- `bit0 RX_READY` : JS→MSXのRXキューに読めるデータがある（次のバイトはPORT1）
- `bit1 TX_READY` : MSX→JS送信を受け付け可能（現行は常に`1`で可）
- `bit2 EV_READY` : 入力イベント準備（`RX_READY`と同義にしてもよい）
- `bit3 BUSY`     : JSが非同期処理中（例: `fetch`）
- `bit4 ERROR`    : 直近処理でエラー（詳細は `RSP_ERROR` パケット）
- `bit7 ALIVE`    : 常に`1`（生存確認）

### パケット形式（JS→MSX、必須）
- `1バイト TYPE`
- `1バイト LEN`（`0..255`）
- `Nバイト PAYLOAD`

MSX側は `STATUS` をポーリングして `RX_READY` を待ち、`PORT1` からパケットを読み出す運用が基本。

### CMD（`OUT PORT0`）

`CMD` を `PORT0` に出した後、必要な引数バイトを `PORT1` に送る。  
JS側は `lastCmd` と `expectedLen` を保持し、所定バイト数を受信したら dispatch する。

| CMD  | 追加データ (PORT1) | 備考 |
| ---- | ------------------ | ---- |
| `0x20 MP3_PLAY` | `1バイト trackId` | |
| `0x21 MP3_STOP` | `0` バイト | |
| `0x22 MP3_VOL`  | `1バイト volume` | |
| `0x30 REQ_TEXT` | `1バイト reqId` | JSは非同期生成し、完了時に `RSP_TEXT` パケットをRXキューへpush。生成中は `STATUS.BUSY` を立ててもよい |
| `0x3F RESET`    | `0` バイト | JS側状態（キュー、`lastCmd`、`ERROR/BUSY`、受信途中）を全クリア |

#### 拡張方針（将来の可変長用メモ）
- *方針B: CMD直後にLEN(1)を`PORT1`へ送り、その後`LEN`バイト送る。*
- *方針C: MSX→JSにも `TYPE/LEN/PAYLOAD` を適用して対称化。*

### 失敗/復旧指針
- 想定外の `PORT1 OUT`（`expectedLen == 0` の状態でデータが来る等）は `STATUS.ERROR` を立てる。
- `RESET` (`CMD = 0x3F`) でエラー・ビジー・受信途中・キューをすべてクリア。
- 任意: `PORT1` が一定時間沈黙したら受信途中を破棄する簡易タイムアウト。

### MSX側ポーリングループ（疑似コード）

```asm
WAIT:   IN   A,(0x48)           ; STATUS
        BIT  0,A                ; RX_READY?
        JR   Z,WAIT
        IN   A,(0x49)           ; TYPE
        LD   B,A
        IN   A,(0x49)           ; LEN
        LD   C,A
READ:   ; Cバイトを0x49から読む
```

---

## エミュレータ外JavaScriptでOUT/INを扱う実装指針

### いつフックするか
- `WMSX.start()` 呼び出し後は `WMSX.room.machine.bus` にアクセスできる。
- ポートを占有する前に、`bus.devicesInputPorts` / `bus.devicesOutputPorts` を確認し、既存デバイスが無いことを必ず確認する。

### OUT（MSX → JS）処理
- `bus.connectOutputDevice(port, handler)` でハンドラを登録する。ハンドラは `(value, port)` を受ける。
- ハンドラ内では**即時に重い処理をしない**。キューに積んで `setTimeout` / `queueMicrotask` などで後続処理を行い、エミュレータのフレームをブロックしない。
- 2ポート短縮版では `PORT0 OUT` が `CMD`、`PORT1 OUT` がコマンド引数。

### IN（JS → MSX）処理
- `bus.connectInputDevice(port, handler)` でハンドラを登録する。ハンドラは `port` を受け、**即時にバイト値を返す必要**がある。
- 非同期データはキューに貯め、空の場合は `0xff` などの「未準備」を返す。
- `STATUS`（`PORT0 IN`）でキュー状態（`RX_READY`）、非同期進行（`BUSY`）、エラー（`ERROR`）を伝える。

### サンプル: Short Protocol v1-2P向け attachBridge()

```js
function attachBridge() {
  const bus = WMSX.room.machine.bus;
  const PORT_CTRL = 0x48;
  const PORT_DATA = 0x49;
  const RX_CAPACITY = 1024;

  // ポート占有チェック
  if (bus.devicesInputPorts[PORT_CTRL] || bus.devicesOutputPorts[PORT_CTRL]) {
    throw new Error("PORT 0x48 is already in use");
  }
  if (bus.devicesInputPorts[PORT_DATA] || bus.devicesOutputPorts[PORT_DATA]) {
    throw new Error("PORT 0x49 is already in use");
  }

  // STATUSビット
  const STATUS = {
    RX_READY: 1 << 0,
    TX_READY: 1 << 1,
    EV_READY: 1 << 2,
    BUSY: 1 << 3,
    ERROR: 1 << 4,
    ALIVE: 1 << 7
  };

  // CMD
  const CMD = { MP3_PLAY: 0x20, MP3_STOP: 0x21, MP3_VOL: 0x22, REQ_TEXT: 0x30, RESET: 0x3f };
  const ARG_LEN = { [CMD.MP3_PLAY]: 1, [CMD.MP3_STOP]: 0, [CMD.MP3_VOL]: 1, [CMD.REQ_TEXT]: 1, [CMD.RESET]: 0 };

  // パケット(TYPE/LEN/PAYLOAD) JS→MSX
  const PKT = { RSP_TEXT: 0x81, RSP_ERROR: 0xe0 };

  // RXリングバッファ（Array.shift禁止）
  const rxBuf = new Uint8Array(RX_CAPACITY);
  let rxHead = 0, rxTail = 0, rxCount = 0;
  const rxPush = (byte) => {
    if (rxCount === RX_CAPACITY) { rxTail = (rxTail + 1) % RX_CAPACITY; rxCount--; } // 古いものから捨てる
    rxBuf[rxHead] = byte & 0xff;
    rxHead = (rxHead + 1) % RX_CAPACITY;
    rxCount++;
  };
  const rxPop = () => {
    if (!rxCount) return 0xff;
    const value = rxBuf[rxTail];
    rxTail = (rxTail + 1) % RX_CAPACITY;
    rxCount--;
    return value;
  };
  const pushPacket = (type, payloadBytes) => {
    rxPush(type);
    rxPush(payloadBytes.length & 0xff);
    payloadBytes.forEach(rxPush);
  };

  let busy = false;
  let error = false;
  let lastCmd = 0x00;
  let expectedLen = 0;
  let rxTmp = [];
  const resetState = () => {
    busy = false;
    error = false;
    lastCmd = 0;
    expectedLen = 0;
    rxTmp = [];
    rxHead = rxTail = rxCount = 0;
  };

  const handleReqText = (reqId) => {
    busy = true;
    queueMicrotask(async () => {
      try {
        // 実際のfetchや生成処理をここに記述（OUTハンドラ外で実行）
        const text = `Hello from JS (req ${reqId})`;
        const bytes = Array.from(new TextEncoder().encode(text)).slice(0, 255);
        pushPacket(PKT.RSP_TEXT, [reqId, ...bytes]);
      } catch (e) {
        error = true;
        pushPacket(PKT.RSP_ERROR, [reqId]);
      } finally {
        busy = false;
      }
    });
  };

  const dispatch = (cmd, args) => {
    switch (cmd) {
      case CMD.MP3_PLAY:
        // オーディオ制御をここに実装
        break;
      case CMD.MP3_STOP:
        break;
      case CMD.MP3_VOL:
        break;
      case CMD.REQ_TEXT:
        handleReqText(args[0] ?? 0);
        return;
      case CMD.RESET:
        resetState();
        return;
      default:
        error = true;
        pushPacket(PKT.RSP_ERROR, [0xff]);
        return;
    }
  };

  bus.connectOutputDevice(PORT_CTRL, (value) => {
    lastCmd = value & 0xff;
    expectedLen = ARG_LEN[lastCmd] ?? 0;
    rxTmp = [];
    if (expectedLen === 0) queueMicrotask(() => dispatch(lastCmd, []));
  });

  bus.connectOutputDevice(PORT_DATA, (value) => {
    if (expectedLen === 0) { error = true; return; }
    rxTmp.push(value & 0xff);
    if (rxTmp.length === expectedLen) {
      queueMicrotask(() => dispatch(lastCmd, rxTmp));
      expectedLen = 0;
    }
  });

  bus.connectInputDevice(PORT_CTRL, () => {
    let status = STATUS.ALIVE | STATUS.TX_READY;
    if (rxCount) status |= STATUS.RX_READY | STATUS.EV_READY;
    if (busy) status |= STATUS.BUSY;
    if (error) status |= STATUS.ERROR;
    return status;
  });

  bus.connectInputDevice(PORT_DATA, () => rxPop());
}
```

ポイント:
- 2ポートのみ（`0x48`=CMD/STATUS、`0x49`=ARG/DATA）。
- 重い処理（例: `fetch`）はOUTハンドラ外で実行（`queueMicrotask` など）。
- RXはリングバッファで保持し、`Array.shift` を使わない。
- `RESET` で受信途中・キュー・フラグを全消去。

### ポート設計のコツ
- 既存デバイスが使用するポートを避ける（VDP: `0x98–0x9b`, PSG: `0xa0–0xa1`, PPI: `0xa8–0xab` など）。
- 将来的に大容量転送が必要なら、専用CMDの後で `PORT1` に長さ付きデータを流す方式を上乗せする。

### クリーンアップ
- ブリッジを外すときは `bus.disconnectInputDevice` / `bus.disconnectOutputDevice` を呼び出してポートを解放する。
- NetPlayなどでRoomが再構成される場合は、再度 `attachBridge` を呼び出して新しい `bus` に繋ぎ直す。

### 旧4ポートShort Protocol（Deprecated）
- `PORT_CMD/ARG/STATUS/DATA` で分割していた旧4ポート版は参照用途として残してもよいが、2ポート版を推奨・優先すること。
