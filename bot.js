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
    .jpeg({ quality: 95 })
    .toBuffer();
  console.log('✅ כרטיס נבנה, גודל:', result.length);
  return result;
}

async function processCard(ctx, templateKey) {
  if (ctx.session.step !== 'waiting_template') return;
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

    try {
      console.log('📤 מנסה sendPhoto מ-stream...');
      await ctx.telegram.sendPhoto(
        ctx.chat.id,
        { source: fs.createReadStream(tmpPath), filename: 'birthday_card.jpg' },
        { caption: `🎂 יום הולדת שמח ${name}! 🎉` }
      );
      console.log('✅ תמונה נשלחה בהצלחה!');
    } catch (sendErr) {
      console.error('❌ שגיאה בשליחת תמונה:', sendErr.message);
      await ctx.telegram.sendMessage(ctx.chat.id, `❌ שגיאה בשליחת התמונה: ${sendErr.message}`);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
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

bot.start((ctx) => {
  ctx.session = {};
  ctx.reply('🎉 ברוך הבא לבוט כרטיסי finitistar!\n\nשלח לי תמונה של האדם שרוצים לברך 👇');
});

bot.on('photo', async (ctx) => {
  ctx.session = ctx.session || {};
  const photos = ctx.message.photo;
  ctx.session.photoFileId = photos[photos.length - 1].file_id;
  ctx.session.step = 'waiting_name';
  await ctx.reply('✅ קיבלתי!\n\nמה השם שיופיע על הכרטיס?');
});

bot.on('text', async (ctx) => {
  ctx.session = ctx.session || {};
  if (ctx.session.step === 'waiting_name') {
    const name = ctx.message.text.trim();
    if (name.length < 2) return ctx.reply('❌ שם קצר מדי, נסה שוב:');
    ctx.session.name = name;
    ctx.session.step = 'waiting_template';
    await ctx.reply(`✅ שם: *${name}*\n\nאיזה טמפלייט?`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[
        Markup.button.callback('⭐ finitistar', 'tmpl_finitistar'),
        Markup.button.callback('🎂 finitiBday', 'tmpl_bday')
      ]])
    });
    return;
  }
  if (!ctx.session.step) {
    ctx.reply('📸 שלח לי קודם תמונה של האדם שרוצים לברך');
  }
});

bot.action('tmpl_finitistar', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(`✅ טמפלייט: ⭐ finitistar | שם: *${ctx.session?.name}*`, { parse_mode: 'Markdown' });
  await processCard(ctx, 'finitistar');
});

bot.action('tmpl_bday', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(`✅ טמפלייט: 🎂 finitiBday | שם: *${ctx.session?.name}*`, { parse_mode: 'Markdown' });
  await processCard(ctx, 'bday');
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
