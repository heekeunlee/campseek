// 알림 채널 (pluggable). 환경변수로 설정.
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  → 텔레그램
//   NOTIFY_WEBHOOK_URL                      → 임의의 웹훅(JSON POST, Slack/Discord 등)
// 설정이 없으면 콘솔 로그만 남깁니다. 웹 UI는 별도로 최신 이벤트를 폴링합니다.

const recent = []; // 최근 알림 이벤트 (웹 UI 표시용)
const MAX_RECENT = 50;

export function recentEvents() {
  return recent;
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false }),
    });
    return true;
  } catch (e) {
    console.error('[notify] 텔레그램 전송 실패:', e.message);
    return false;
  }
}

async function sendWebhook(payload) {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return false;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Slack/Discord 호환: text 필드 + content 필드 모두 제공
      body: JSON.stringify({ text: payload.text, content: payload.text, ...payload }),
    });
    return true;
  } catch (e) {
    console.error('[notify] 웹훅 전송 실패:', e.message);
    return false;
  }
}

/**
 * 빈자리 발견 알림.
 * @param {object} watch  감시 항목
 * @param {Array}  hits   예약가능(availableCount>0) 결과들
 */
export async function notifyAvailability(watch, hits) {
  const sectionNm = watch.section === '02' ? '야영장' : '숲속의 집';
  const lines = hits.map(
    (h) => `• ${h.name} (${h.type}) — 예약가능 ${h.availableCount}`
  );
  const title = `🏕️ 빈자리 발견: ${watch.label || sectionNm} ${watch.beginDate}~${watch.endDate}`;
  const text = [title, ...lines, '', '➡ 숲나들e에서 바로 예약하세요.'].join('\n');

  const event = {
    at: new Date().toISOString(),
    watchId: watch.id,
    title,
    hits: hits.map((h) => ({ name: h.name, type: h.type, availableCount: h.availableCount })),
    text,
  };
  recent.unshift(event);
  if (recent.length > MAX_RECENT) recent.pop();

  const chans = [];
  if (await sendTelegram(text)) chans.push('telegram');
  if (await sendWebhook(event)) chans.push('webhook');
  console.log(`[notify] ${title} (채널: ${chans.join(',') || 'console'})`);
  return event;
}
