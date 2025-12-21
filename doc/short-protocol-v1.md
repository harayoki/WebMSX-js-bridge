# WebMSX I/O JSブリッジ: Short Protocol v1（ループ前提）

## 目的
- 低レイテンシで堅牢な短いやり取りを実現する
- 対象: MP3再生制御 / 入力イベント通知（スワイプ・加速度）/ 255バイト程度の文字列取得
- 大容量転送（面データ等）は本プロトコル対象外（別途Bulk Protocol）

## 使用ポート（例：空き領域から4連番）
- PORT_CMD    = 0x48  (MSX -> JS)  コマンド/リクエスト発行
- PORT_ARG    = 0x49  (MSX -> JS)  引数（reqId/trackId/param等）
- PORT_STATUS = 0x4A  (JS  -> MSX) 状態取得（ビットフィールド）
- PORT_DATA   = 0x4B  (JS  -> MSX, MSX -> JS) データバイト（パケット本体）

※既存デバイス使用ポートと衝突しないよう、接続前に bus.devicesInputPorts / devicesOutputPorts を確認すること。

## STATUS（IN PORT_STATUS）ビット定義
- bit0 RX_READY   : JS->MSX の受信バッファに読めるデータがある（PORT_DATAで読める）
- bit1 TX_READY   : MSX->JS の送信が受け入れ可能（常に1でもよい。将来フロー制御用）
- bit2 EV_READY   : 入力イベント（スワイプ/加速度等）が準備できている（RX_READYと同義でも可）
- bit3 BUSY       : JS側が生成処理中（ネット取得など）
- bit4 ERROR      : 直近の処理でエラー（エラーコードは次のDATAパケットで返す）
- bit7 ALIVE      : 常に1（接続確認用）

## DATAパケット形式（JS->MSX, MSX->JS 共通の概念）
- 1 byte: TYPE
- 1 byte: LEN   (0..255)
- N bytes: PAYLOAD (N = LEN)

※MSX側は基本「INで受ける」運用。MSX->JSはCMD/ARG中心でDATA送信は最小にする（必要なら同形式で送る）。

## TYPE 定義（JS->MSX の通知/応答）
- 0x01 EVT_SWIPE
  - payload: [dir:1][strength:1]
  - dir: 0=left 1=right 2=up 3=down
  - strength: 0..255（任意スケール）
- 0x02 EVT_ACCEL
  - payload: [ax:1][ay:1][az:1]
  - 各値は signed byte を (value + 128) で格納（0..255）
- 0x10 RSP_TEXT
  - payload: UTF-8 bytes（LENがバイト長）
  - 文字列は「最大255バイト」。文字数ではない
- 0x7E RSP_ERROR
  - payload: [errCode:1][context:1(optional)]
  - errCode例: 1=TIMEOUT 2=NETWORK 3=NOT_FOUND 4=BUSY 5=BAD_REQ

## CMD（OUT PORT_CMD）定義（MSX->JS 制御）
- 0x20 MP3_PLAY
  - OUT ARG に trackId（0..255）
- 0x21 MP3_STOP
  - ARG不要
- 0x22 MP3_VOL
  - OUT ARG に volume（0..255）

- 0x30 REQ_TEXT
  - OUT ARG に reqId（0..255）
  - JSは非同期で生成し、完了したら DATA に RSP_TEXT を積む
  - 生成中は STATUS.BUSY=1 でもよい
  - 失敗時は RSP_ERROR を積み、STATUS.ERROR=1 を立ててもよい

- 0x3F RESET
  - JS側のキュー/状態を全クリア（RXバッファ破棄、ERROR解除、BUSY解除）
  - MSX側が復旧のために使う

## JS側 実装要件
- connectOutputDevice(PORT_CMD, handler) で CMD受信
- connectOutputDevice(PORT_ARG, handler) で ARG受信（直近CMDに紐づく）
- connectInputDevice(PORT_STATUS, handler) は即時にステータスを返す
- connectInputDevice(PORT_DATA, handler) は RXキューから1バイト返す（無ければ 0xFF）
- RXキューは「リングバッファ」推奨（Array.shift禁止）
- 入力イベント（スワイプ/加速度）は「最新優先」
  - 溜める方式でもよいが、溢れたら古いのを捨てる
- 重い処理（fetch等）は OUTハンドラ内で直実行しない
  - キューに積んで非同期で実施
  - 完了したら RSP_TEXT/RSP_ERROR パケットを RXキューに push

## MSX側 受信ループ（概念）
1) wait:
   - do IN STATUS until RX_READY==1 (or timeout)
2) read packet:
   - type = IN DATA
   - len  = IN DATA
   - repeat len times: payload[i] = IN DATA
3) dispatch by type
4) ERRORビットが立っていたら CMD=RESET して復旧

## 注意
- 本プロトコルは短文・イベント向け。面データ等の大容量は別の Bulk Protocol を作ること。
- 文字列は「最大255バイト」。UTF-8で日本語を返す場合、文字数はもっと少なくなる。
