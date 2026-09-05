const TIMEOUT_MESSAGE = 'ไม่ได้รับคำตอบจากเซิร์ฟเวอร์ภายใน 30 วินาที กรุณาตรวจอินเทอร์เน็ต และให้ผู้ดูแลอัปเดต Apps Script เป็นเวอร์ชันล่าสุด (Deploy → Manage deployments → New version, Execute as Me, Anyone) หากเพิ่งสร้าง Admin ให้ลองเข้าสู่ระบบก่อนสร้างซ้ำ';

function isGoogleOrigin(origin) {
  return origin === 'https://script.google.com' || origin === 'https://script.googleusercontent.com' || /^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/.test(origin);
}

// HtmlService executes inside Google's sandbox frame, nested in our response frame.
// Window.parent is readable across origins; require the sender to belong to this request.
function belongsToFrame(source, frameWindow) {
  try {
    for (let depth = 0; source && depth < 10; depth++) {
      if (source === frameWindow) return true;
      if (source.parent === source) return false;
      source = source.parent;
    }
  } catch { /* A detached or non-window source cannot answer this request. */ }
  return false;
}

/** @returns {Promise<any>} */
export function postThroughFrame(apiUrl, payload) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const frame = document.createElement('iframe');
    const form = document.createElement('form');
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error(TIMEOUT_MESSAGE)), 30000);

    function finish(error, result) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      frame.removeEventListener('error', onError);
      form.remove();
      frame.remove();
      if (error) reject(error); else resolve(result);
    }
    function onError() {
      finish(new Error('โหลดการเชื่อมต่อ Apps Script ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตและสิทธิ์ Web app'));
    }
    function onMessage(event) {
      if (!isGoogleOrigin(event.origin) || !belongsToFrame(event.source, frame.contentWindow)) return;
      const message = event.data;
      if (!message || message.type !== 'wh-receive-response' || message.requestId !== requestId) return;
      if (!message.result || typeof message.result.ok !== 'boolean') {
        finish(new Error('รูปแบบคำตอบจาก Apps Script ไม่ถูกต้อง กรุณาให้ผู้ดูแลอัปเดต backend'));
        return;
      }
      finish(null, message.result);
    }

    try {
      frame.name = 'wh-receive-' + requestId;
      frame.hidden = true;
      frame.title = 'WH Receive response';
      form.method = 'post';
      form.action = apiUrl;
      form.target = frame.name;
      form.hidden = true;
      for (const [name, value] of Object.entries({transport:'iframe', requestId, origin:window.location.origin, payload:JSON.stringify(payload)})) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.append(input);
      }
      window.addEventListener('message', onMessage);
      frame.addEventListener('error', onError);
      document.body.append(frame, form);
      form.submit();
    } catch (error) {
      finish(error);
    }
  });
}
