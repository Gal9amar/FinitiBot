require('dotenv').config();
const { Telegraf, session, Markup } = require('telegraf');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const http = require('http');
const path = require('path');

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('finitistar bot is alive 🤖');
}).listen(PORT, () => {
  console.log(`🌐 Health check server on port ${PORT}`);
});

const TEMPLATES = {
  finitistar: {
    path: path.join(__dirname, 'template.jpg'),
    label: '⭐ finitistar',
    person: { left: 1050, top: 0, width: 870, height: 1080 },
    name: { x: 40, y: 980, fontSize: 200, fontWeight: 900, color: '#1a3faa', letterSpacing: -5 }
  },
  bday: {
    path: path.join(__dirname, 'template_bday.jpg'),
    label: '🎂 finitiBday',
    person: { left: 980, top: 0, width: 940, height: 1080 },
    name: { x: 30, y: 1060, fontSize: 260, fontWeight: 900, color: '#1a3faa', letterSpacing: -8 }
  }
};

async function removeBackground(imageBuffer) {
  console.log('📤 שולח ל-remove.bg...');
  const formData = new FormData();
  formData.append('image_file', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
  formData.append('size', 'auto');
  const response = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
    headers: { 'X-Api-Key': process.env.REMOVE_BG_API_KEY, ...formData.getHeaders() },
    responseType: 'arraybuffer',
    maxContentLength: Infinity,
    timeout: 60000
  });
  console.log('✅ remove.bg הצליח, גודל:', response.data.byteLength);
  return Buffer.from(response.data);
}

async function preparePersonImage(noBgBuffer, personConfig) {
  console.log('🖼️ מעבד תמונה עם sharp...');
  const result = await sharp(noBgBuffer)
    .resize(personConfig.width, personConfig.height, {
      fit: 'contain', position: 'bottom',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
  console.log('✅ sharp הצליח, גודל:', result.length);
  return result;
}

async function buildCard(personBuffer, name, templateKey) {
  console.log('🎨 בונה כרטיס...');
  const tmpl = TEMPLATES[templateKey];
  const nc = tmpl.name;
  const nameSvg = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
    <text x="${nc.x}" y="${nc.y}"
      font-family="Arial Black, Impact, sans-serif"
      font-size="${nc.fontSize}" font-weight="${nc.fontWeight}"
      fill="${nc.color}" letter-spacing="${nc.letterSpacing}"
    >${name.toUpperCase()}</text>
  </svg>`;
  const result = await sharp(tmpl.path)
    .composite([
      { input: personBuffer, left: tmpl.person.left, top: tmpl.person.top },
      { input: Buffer.from(nameSvg), left: 0, top: 0 }
    ])
    .resize(1280, 720).jpeg({ quality: 75 })
    .toBuffer();
  console.log('✅ כרטיס נבנה, גודל:', result.length);
  return result;
}

async function processCard(ctx, templateKey) {
  if (ctx.session.step !== 'waiting_name') return;
  const { name, photoFileId } = ctx.session;
  ctx.session = {};
  const processingMsg = await ctx.reply('⏳ מעבד...');
  try {
    console.log(`🚀 מתחיל עיבוד: ${name} / ${templateKey}`);
    console.log('📥 מוריד תמונה מטלגרם...');
    const fileLink = await ctx.telegram.getFileLink(photoFileId);
    const photoResponse = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 30000 });
    console.log('✅ תמונה הורדה, גודל:', photoResponse.data.byteLength);
    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, '⏳ מסיר רקע...');
    const noBgBuffer = await removeBackground(Buffer.from(photoResponse.data));
    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, '⏳ בונה כרטיס...');
    const personBuffer = await preparePersonImage(noBgBuffer, TEMPLATES[templateKey].person);
    const cardBuffer = await buildCard(personBuffer, name, templateKey);
    console.log('📨 שולח תמונה לטלגרם... chat_id:', ctx.chat.id);
    console.log('📦 גודל cardBuffer:', cardBuffer.length);

    // שמירה לקובץ זמני ושליחה כ-stream
    const fs = require('fs');
    const tmpPath = `/tmp/card_${Date.now()}.jpg`;
    fs.writeFileSync(tmpPath, cardBuffer);
    console.log('💾 נשמר לקובץ זמני:', tmpPath);

    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
      console.log('🗑️ הודעת processing נמחקה');
    } catch (delErr) {
      console.log('⚠️ לא הצלחתי למחוק הודעה:', delErr.message);
    }

    // שליחה ישירה עם axios + retry 3 פעמים
    let sent = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`📤 ניסיון ${attempt}/3...`);
        const FormDataSend = require('form-data');
        const sendForm = new FormDataSend();
        sendForm.append('chat_id', String(ctx.chat.id));
        sendForm.append('caption', `🎂 יום הולדת שמח ${name}! 🎉`);
        sendForm.append('photo', fs.createReadStream(tmpPath), { filename: 'birthday_card.jpg', contentType: 'image/jpeg' });
        const sendResp = await axios.post(
          `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendPhoto`,
          sendForm,
          { headers: sendForm.getHeaders(), timeout: 60000, maxContentLength: Infinity }
        );
        if (sendResp.data.ok) {
          console.log('✅ תמונה נשלחה בהצלחה!');
          sent = true;
          break;
        }
      } catch (sendErr) {
        console.error(`❌ ניסיון ${attempt} נכשל:`, sendErr.message);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (!sent) await ctx.telegram.sendMessage(ctx.chat.id, '❌ לא הצלחתי לשלוח את התמונה. נסה שוב.');
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  } catch (error) {
    console.error('❌ שגיאה:', error.message);
    const errMsg = error.message.includes('timeout')
      ? '❌ timeout – נסה עם תמונה קטנה יותר.'
      : error.message.includes('402') || error.message.includes('403')
      ? '❌ בעיה עם remove.bg API key.'
      : `❌ שגיאה: ${error.message}`;
    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, errMsg).catch(() => {});
  }
}

function askTemplate(ctx) {
  return ctx.reply('🎨 בחר טמפלייט:', {
    ...Markup.inlineKeyboard([[
      Markup.button.callback('⭐ finitistar', 'tmpl_finitistar'),
      Markup.button.callback('🎂 finitiBday', 'tmpl_bday')
    ]])
  });
}

bot.start((ctx) => {
  ctx.session = {};
  askTemplate(ctx);
});

bot.on('photo', async (ctx) => {
  ctx.session = ctx.session || {};
  if (ctx.session.step !== 'waiting_photo') {
    ctx.session = {};
    await askTemplate(ctx);
    return;
  }
  const photos = ctx.message.photo;
  ctx.session.photoFileId = photos[photos.length - 1].file_id;
  ctx.session.step = 'waiting_name';
  await ctx.reply('✅ קיבלתי!

מה השם שיופיע על הכרטיס?');
});

bot.on('text', async (ctx) => {
  ctx.session = ctx.session || {};
  if (ctx.session.step === 'waiting_name') {
    const name = ctx.message.text.trim();
    if (name.length < 2) return ctx.reply('❌ שם קצר מדי, נסה שוב:');
    ctx.session.name = name;
    await processCard(ctx, ctx.session.templateKey);
    return;
  }
  ctx.session = {};
  askTemplate(ctx);
});

bot.action('tmpl_finitistar', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session = ctx.session || {};
  ctx.session.templateKey = 'finitistar';
  ctx.session.step = 'waiting_photo';
  await ctx.editMessageText('✅ טמפלייט: ⭐ finitistar\n\n📸 שלח תמונה של האדם שרוצים לברך');
});

bot.action('tmpl_bday', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session = ctx.session || {};
  ctx.session.templateKey = 'bday';
  ctx.session.step = 'waiting_photo';
  await ctx.editMessageText('✅ טמפלייט: 🎂 finitiBday\n\n📸 שלח תמונה של האדם שרוצים לברך');
});

// ============================================================
// הפעלה עם ניקוי webhook קודם למניעת 409 Conflict
// ============================================================
async function startBot() {
  try {
    console.log('🧹 מנקה webhook קודם...');
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log('✅ webhook נוקה');
  } catch (e) {
    console.log('webhook cleanup:', e.message);
  }
  
  await bot.launch({
    allowedUpdates: ['message', 'callback_query']
  });
  console.log('🤖 finitistar bot is running...');
}

startBot();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
