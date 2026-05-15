require('dotenv').config();
const { Telegraf, session, Markup } = require('telegraf');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const http = require('http');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('finitistar bot is alive');
}).listen(PORT, () => {
  console.log('Health check server on port ' + PORT);
});

const TEMPLATES = {
  finitistar: {
    path: path.join(__dirname, 'template.jpg'),
    person: { left: 1050, top: 0, width: 870, height: 1080 },
    name: { x: 40, y: 980, fontSize: 200, color: '#1a3faa', letterSpacing: -5 }
  },
  bday: {
    path: path.join(__dirname, 'template_bday.jpg'),
    person: { left: 980, top: 0, width: 940, height: 1080 },
    name: { x: 30, y: 1060, fontSize: 260, color: '#1a3faa', letterSpacing: -8 }
  }
};

async function removeBackground(imageBuffer) {
  console.log('Sending to remove.bg...');
  const formData = new FormData();
  formData.append('image_file', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
  formData.append('size', 'auto');
  const response = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
    headers: { 'X-Api-Key': process.env.REMOVE_BG_API_KEY, ...formData.getHeaders() },
    responseType: 'arraybuffer',
    maxContentLength: Infinity,
    timeout: 60000
  });
  console.log('remove.bg done, size: ' + response.data.byteLength);
  return Buffer.from(response.data);
}

async function preparePersonImage(noBgBuffer, personConfig) {
  return await sharp(noBgBuffer)
    .resize(personConfig.width, personConfig.height, {
      fit: 'contain', position: 'bottom',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}

async function buildCard(personBuffer, name, templateKey) {
  const tmpl = TEMPLATES[templateKey];
  const nc = tmpl.name;
  const nameSvg = '<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">'
    + '<text x="' + nc.x + '" y="' + nc.y + '"'
    + ' font-family="Arial Black, Impact, sans-serif"'
    + ' font-size="' + nc.fontSize + '" font-weight="900"'
    + ' fill="' + nc.color + '" letter-spacing="' + nc.letterSpacing + '"'
    + '>' + name.toUpperCase() + '</text></svg>';

  return await sharp(tmpl.path)
    .composite([
      { input: personBuffer, left: tmpl.person.left, top: tmpl.person.top },
      { input: Buffer.from(nameSvg), left: 0, top: 0 }
    ])
    .resize(1280, 720)
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function processCard(ctx, templateKey) {
  if (!ctx.session || ctx.session.step !== 'waiting_name') return;
  const name = ctx.session.name;
  const photoFileId = ctx.session.photoFileId;
  ctx.session = {};

  const processingMsg = await ctx.reply('Processing...');

  try {
    console.log('Starting: ' + name + ' / ' + templateKey);

    const fileLink = await ctx.telegram.getFileLink(photoFileId);
    const photoResponse = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 30000 });
    console.log('Photo downloaded: ' + photoResponse.data.byteLength);

    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, 'Removing background...');
    const noBgBuffer = await removeBackground(Buffer.from(photoResponse.data));

    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, 'Building card...');
    const personBuffer = await preparePersonImage(noBgBuffer, TEMPLATES[templateKey].person);
    const cardBuffer = await buildCard(personBuffer, name, templateKey);
    console.log('Card built, size: ' + cardBuffer.length);

    const tmpPath = '/tmp/card_' + Date.now() + '.jpg';
    fs.writeFileSync(tmpPath, cardBuffer);

    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    } catch (e) {}

    let sent = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log('Sending attempt ' + attempt + '/3...');
        const sendForm = new FormData();
        sendForm.append('chat_id', String(ctx.chat.id));
        sendForm.append('caption', 'Happy Birthday ' + name + '! 🎉');
        sendForm.append('photo', fs.createReadStream(tmpPath), { filename: 'card.jpg', contentType: 'image/jpeg' });
        const resp = await axios.post(
          'https://api.telegram.org/bot' + process.env.BOT_TOKEN + '/sendPhoto',
          sendForm,
          { headers: sendForm.getHeaders(), timeout: 60000, maxContentLength: Infinity }
        );
        if (resp.data.ok) {
          console.log('Photo sent successfully!');
          sent = true;
          break;
        }
      } catch (e) {
        console.error('Attempt ' + attempt + ' failed: ' + e.message);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }

    try { fs.unlinkSync(tmpPath); } catch (e) {}

    if (!sent) {
      await ctx.telegram.sendMessage(ctx.chat.id, 'Failed to send photo after 3 attempts. Please try again.');
    }

  } catch (error) {
    console.error('Error: ' + error.message);
    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, 'Error: ' + error.message).catch(() => {});
  }
}

function askTemplate(ctx) {
  return ctx.reply('Choose template:', Markup.inlineKeyboard([[
    Markup.button.callback('finitistar', 'tmpl_finitistar'),
    Markup.button.callback('finitiBday', 'tmpl_bday')
  ]]));
}

bot.start((ctx) => {
  ctx.session = {};
  askTemplate(ctx);
});

bot.action('tmpl_finitistar', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session = { templateKey: 'finitistar', step: 'waiting_photo' };
  await ctx.editMessageText('Template: finitistar\n\nNow send a photo of the person:');
});

bot.action('tmpl_bday', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session = { templateKey: 'bday', step: 'waiting_photo' };
  await ctx.editMessageText('Template: finitiBday\n\nNow send a photo of the person:');
});

bot.on('photo', async (ctx) => {
  ctx.session = ctx.session || {};
  if (ctx.session.step !== 'waiting_photo') {
    ctx.session = {};
    return askTemplate(ctx);
  }
  const photos = ctx.message.photo;
  ctx.session.photoFileId = photos[photos.length - 1].file_id;
  ctx.session.step = 'waiting_name';
  await ctx.reply('Got it! What is the name for the card?');
});

bot.on('text', async (ctx) => {
  ctx.session = ctx.session || {};
  if (ctx.session.step === 'waiting_name') {
    const name = ctx.message.text.trim();
    if (name.length < 2) return ctx.reply('Name too short, try again:');
    ctx.session.name = name;
    await processCard(ctx, ctx.session.templateKey);
    return;
  }
  ctx.session = {};
  askTemplate(ctx);
});

async function startBot() {
  try {
    const webhookPromise = bot.telegram.deleteWebhook({ drop_pending_updates: true });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
    await Promise.race([webhookPromise, timeoutPromise]);
    console.log('Webhook cleared');
  } catch (e) {
    console.log('Webhook cleanup skipped: ' + e.message);
  }
  bot.launch({ allowedUpdates: ['message', 'callback_query'] });
  console.log('finitistar bot is running...');
}

startBot();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
