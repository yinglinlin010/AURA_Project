import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:8080/ws');

let sessionId = '';

ws.on('open', () => {
  console.log('[Test Script] Connected to AURA Gateway.');
  // 1. 註冊偽裝身分
  ws.send(JSON.stringify({
    kind: 'register',
    protocolVersion: 1,
    displayId: 'center-main',
    deviceId: 'main-computer',
    traceId: 'hack-test-1'
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.kind === 'welcome') {
    sessionId = msg.sessionId;
    console.log('[Test Script] Got Session ID:', sessionId);

    // 2. 送出時速 120 km/h 的假指令
    console.log('[Test Script] Injecting Speed: 120 km/h...');
    ws.send(JSON.stringify({
      kind: 'command',
      envelope: {
        sessionId,
        traceId: 'hack-test-speed',
        sender: { displayId: 'center-main', deviceId: 'main-computer' },
        command: {
          type: 'vehicle.telemetry.report',
          payload: { vehicle: { speedKph: 120 } }
        }
      }
    }));

    // 3. 過兩秒後，如果無法觸發 AEB，我們強制送一個假的認知負載過高或警告
    // 其實更好的方式是看前端怎麼寫，我們已經把前端對齊到 vehicle.state.updated
  } else if (msg.kind === 'ack') {
    console.log('[Test Script] Command Acked!');
    process.exit(0);
  }
});

ws.on('error', console.error);
