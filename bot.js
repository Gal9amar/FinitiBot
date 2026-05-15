require('dotenv').config();
const { Telegraf, session, Markup } = require('telegraf');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const http = require('http');
const path = require('path');

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// ============================================================
// HTTP server קטן כדי ש-Render לא יכבה את הסרביס
// ו-UptimeRobot יוכל לעשות ping
// ============================================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('finitistar bot is alive 🤖');
}).listen(PORT, () => {
  console.log(`🌐 Health check server on port ${PORT}`);
});

// ============================================================
// טמפלייטים
// ============================================================
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

// ============================================================
// הסרת רקע
// ============================================================
async function removeBackground(imageBuffer) {
  const formData = new FormData();
  formData.append('image_file', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
  formData.append('size', 'auto');
  const response = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
    headers: { 'X-Api-Key': process.env.REMOVE_BG_API_KEY, ...formData.getHeaders() },
    responseType: 'arraybuffer',
    maxContentLength: Infinity,
    timeout: 30000
  });
  return Buffer.from(response.data);
}

// ============================================================
// עיבוד תמונה
// ============================================================
async function preparePersonImage(noBgBuffer, personConfig) {
  return await sharp(noBgBuffer)
    .resize(personConfig.width, personConfig.height, {
      fit: 'contain', position: 'bottom',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}

// ============================================================
// בניית כרטיס
// ============================================================
async function buildCard(personBuffer, name, templateKey) {
  const tmpl = TEMPLATES[templateKey];
  const nc = tmpl.name;
  const nameSvg = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
    <text x="${nc.x}" y="${nc.y}"
      font-family="Arial Black, Impact, sans-serif"
      font-size="${nc.fontSize}" font-weight="${nc.fontWeight}"
      fill="${nc.color}" letter-spacing="${nc.letterSpacing}"
    >${name.toUpperCase()}</text>
  </svg>`;
  return await sharp(tmpl.path)
    .composite([
      { input: personBuffer, left: tmpl.person.left, top: tmpl.person.top },
      { input: Buffer.from(nameSvg), left: 0, top: 0 }
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
}

// ============================================================
// עיבוד ושליחת כרטיס
// ============================================================
async function processCard(ctx, templateKey) {
  if (ctx.session.step !== 'waiting_template') return;
  const { name, photoFileId } = ctx.session;
  ctx.session = {};
  const processingMsg = await ctx.reply('⏳ מעבד...');
  try {
    const fileLink = await ctx.telegram.getFileLink(photoFileId);
    const photoResponse = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 15000 });
    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, '⏳ מסיר רקע...');
    const noBgBuffer = await removeBackground(Buffer.from(photoResponse.data));
    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, '⏳ בונה כרטיס...');
    const personBuffer = await preparePersonImage(noBgBuffer, TEMPLATES[templateKey].person);
    const cardBuffer = await buildCard(personBuffer, name, templateKey);
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.replyWithPhoto({ source: cardBuffer }, { caption: `🎂 יום הולדת שמח ${name}! 🎉` });
  } catch (error) {
    console.error('Error:', error.message);
    await ctx.telegram.editMessageText(
      ctx.chat.id, processingMsg.message_id, null,
      '❌ שגיאה בעיבוד. נסה שוב מההתחלה.'
    ).catch(() => {});
  }
}

// ============================================================
// לוגיקת בוט
// ============================================================
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

bot.launch();
console.log('🤖 finitistar bot is running...');
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
