// IO Port JS Bridge sample for WebMSX
// - Monitors MSX OUT on ports 0x50 and 0x51
// - Lets the host page push bytes to MSX IN via ports 0x52 (status) and 0x53 (data)
// - Renders a simple panel below the emulator to visualize traffic

(function attachSampleBridge() {
  const PORT_OUT_A = 0x50; // MSX -> JS (keys 1-4 in the BASIC sample)
  const PORT_OUT_B = 0x51; // MSX -> JS (keys 5-8 in the BASIC sample)
  const PORT_STATUS = 0x52; // JS -> MSX status (1 when data available)
  const PORT_IN_DATA = 0x53; // JS -> MSX data

  const state = {
    bus: null,
    inbox: [],
    outLog: [],
    ui: null,
    handlers: {},
  };

  function toHex(value) {
    return `0x${value.toString(16).padStart(2, "0")}`;
  }

  function renderOutLog() {
    if (!state.ui) return;
    const list = state.ui.querySelector(".io-out-log");
    list.innerHTML = "";
    state.outLog.slice(-12).forEach((entry) => {
      const li = document.createElement("li");
      li.textContent = entry;
      list.appendChild(li);
    });
  }

  function renderInbox() {
    if (!state.ui) return;
    const status = state.ui.querySelector(".io-status");
    const queue = state.ui.querySelector(".io-queue");
    status.textContent = state.inbox.length ? "READY" : "EMPTY";
    queue.textContent = state.inbox.length ? state.inbox.join(", ") : "(none)";
  }

  function recordOut(port, value) {
    const line = `OUT ${toHex(port)} <= ${value}`;
    state.outLog.push(line);
    renderOutLog();
  }

  function pushInbound(value) {
    state.inbox.push(value & 0xff);
    renderInbox();
  }

  function createUi() {
    const host = document.querySelector("#wmsx") || document.body;
    const panel = document.createElement("div");
    panel.id = "io-port-bridge-panel";
    panel.innerHTML = `
      <style>
        #io-port-bridge-panel {
          margin: 12px auto;
          padding: 12px;
          max-width: 720px;
          background: #0f111a;
          color: #e8edf2;
          font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
          border-radius: 10px;
          border: 1px solid #2d3448;
          box-shadow: 0 3px 12px rgba(0, 0, 0, 0.3);
        }
        #io-port-bridge-panel h3 {
          margin: 0 0 8px 0;
          font-size: 16px;
        }
        #io-port-bridge-panel button {
          margin: 4px 6px 6px 0;
          padding: 6px 10px;
          background: #283044;
          color: #e8edf2;
          border: 1px solid #3a4260;
          border-radius: 6px;
          cursor: pointer;
        }
        #io-port-bridge-panel button:hover { background: #343e5c; }
        #io-port-bridge-panel ul { margin: 6px 0; padding-left: 18px; }
        #io-port-bridge-panel .row { margin: 6px 0; }
        #io-port-bridge-panel .label { display: inline-block; width: 96px; color: #9fb1d4; }
      </style>
      <h3>IO Port JS Bridge Sample</h3>
      <div class="row"><span class="label">OUT watch:</span> ${toHex(PORT_OUT_A)} / ${toHex(PORT_OUT_B)}</div>
      <div class="row"><span class="label">IN ports:</span> status ${toHex(PORT_STATUS)}, data ${toHex(PORT_IN_DATA)}</div>
      <div class="row">
        <span class="label">Send to MSX:</span>
        <div class="io-send"></div>
      </div>
      <div class="row"><span class="label">MSX IN queue:</span><span class="io-queue">(none)</span> <span class="io-status">EMPTY</span></div>
      <div class="row">
        <span class="label">OUT log:</span>
        <ul class="io-out-log"></ul>
      </div>
    `;

    const sendContainer = panel.querySelector(".io-send");
    [0x10, 0x20, 0x30, 0x40].forEach((value) => {
      const btn = document.createElement("button");
      btn.textContent = `Queue ${value}`;
      btn.addEventListener("click", () => pushInbound(value));
      sendContainer.appendChild(btn);
    });

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear queue";
    clearBtn.addEventListener("click", () => {
      state.inbox.length = 0;
      renderInbox();
    });
    sendContainer.appendChild(clearBtn);

    host.parentNode.insertBefore(panel, host.nextSibling);
    state.ui = panel;
    renderInbox();
    renderOutLog();
  }

  function connectPorts(bus) {
    state.handlers.outA = (value) => recordOut(PORT_OUT_A, value & 0xff);
    state.handlers.outB = (value) => recordOut(PORT_OUT_B, value & 0xff);
    state.handlers.inStatus = () => (state.inbox.length ? 1 : 0);
    state.handlers.inData = () => {
      const next = state.inbox.length ? state.inbox.shift() : 0;
      renderInbox();
      return next;
    };

    bus.connectOutputDevice(PORT_OUT_A, state.handlers.outA);
    bus.connectOutputDevice(PORT_OUT_B, state.handlers.outB);
    bus.connectInputDevice(PORT_STATUS, state.handlers.inStatus);
    bus.connectInputDevice(PORT_IN_DATA, state.handlers.inData);
  }

  function ensurePortsAreFree(bus) {
    const conflicts = [];
    if (bus.devicesOutputPorts[PORT_OUT_A]) conflicts.push(toHex(PORT_OUT_A));
    if (bus.devicesOutputPorts[PORT_OUT_B]) conflicts.push(toHex(PORT_OUT_B));
    if (bus.devicesInputPorts[PORT_STATUS]) conflicts.push(toHex(PORT_STATUS));
    if (bus.devicesInputPorts[PORT_IN_DATA]) conflicts.push(toHex(PORT_IN_DATA));
    if (conflicts.length) {
      console.warn("IO bridge sample: ports already in use:", conflicts.join(", "));
    }
  }

  function waitForBus() {
    return new Promise((resolve) => {
      function poll() {
        const bus = window.WMSX?.room?.machine?.bus;
        if (bus) return resolve(bus);
        requestAnimationFrame(poll);
      }
      poll();
    });
  }

  async function bootstrap() {
    const bus = await waitForBus();
    ensurePortsAreFree(bus);
    state.bus = bus;
    createUi();
    connectPorts(bus);
    console.log("IO bridge sample attached:", {
      outPorts: [toHex(PORT_OUT_A), toHex(PORT_OUT_B)],
      inPorts: [toHex(PORT_STATUS), toHex(PORT_IN_DATA)],
    });
  }

  window.addEventListener("load", bootstrap);
})();
