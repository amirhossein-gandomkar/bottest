const { Telegraf, Markup } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const mammoth = require('mammoth'); // برای خواندن docx
const { Document, Packer, Paragraph, TextRun } = require('docx'); // برای ساخت docx

// دریافت توکن‌ها از محیط Vercel
const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// بررسی وجود توکن‌ها
if (!BOT_TOKEN || !GEMINI_API_KEY) {
    throw new Error('BOT_TOKEN or GEMINI_API_KEY is missing!');
}

const bot = new Telegraf(BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// تنظیم دستور شروع
bot.start((ctx) => {
    ctx.reply('سلام! 👋\nمن ربات هوشمند خلاصه‌سازی هستم.\n\nمتن خود را بفرستید یا فایل .txt یا .docx آپلود کنید تا آن را برایتان خلاصه کنم.');
});

// تابع کمکی برای خلاصه کردن متن با هوش مصنوعی
async function summarizeText(text) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const prompt = `متن زیر را به زبان فارسی خلاصه کن و نکات کلیدی آن را بنویس:\n\n${text}`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error generating summary:", error);
        return "متاسفانه در ارتباط با هوش مصنوعی خطایی رخ داد.";
    }
}

// مدیریت دریافت متن معمولی
bot.on('text', async (ctx) => {
    const userText = ctx.message.text;
    
    if (userText.length < 50) {
        return ctx.reply('متن شما خیلی کوتاه است. لطفاً متن طولانی‌تری بفرستید.');
    }

    const waitingMsg = await ctx.reply('⏳ در حال خواندن و خلاصه کردن متن شما...');

    try {
        const summary = await summarizeText(userText);
        
        // ارسال خلاصه به صورت متن
        await ctx.telegram.editMessageText(ctx.chat.id, waitingMsg.message_id, null, 
            `📝 **خلاصه متن:**\n\n${summary}`, 
            { parse_mode: 'Markdown' }
        );

        // نمایش دکمه‌ها برای دانلود فایل
        await ctx.reply('آیا می‌خواهید این خلاصه را به صورت فایل دریافت کنید؟', 
            Markup.inlineKeyboard([
                [Markup.button.callback('📄 دانلود به عنوان TXT', 'get_txt')],
                [Markup.button.callback('📘 دانلود به عنوان DOCX', 'get_doc')]
            ])
        );

    } catch (error) {
        ctx.reply('خطایی رخ داد. لطفاً دوباره تلاش کنید.');
    }
});

// مدیریت دریافت فایل (Document)
bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    const mimeType = doc.mime_type;

    // بررسی فرمت فایل
    if (mimeType !== 'text/plain' && !mimeType.includes('wordprocessingml')) {
        return ctx.reply('❌ فقط فایل‌های .txt و .docx پشتیبانی می‌شوند.');
    }

    const waitingMsg = await ctx.reply('⏳ در حال دانلود و پردازش فایل...');

    try {
        // دریافت لینک دانلود فایل از تلگرام
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const response = await axios({ url: fileLink.href, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        let extractedText = "";

        if (mimeType === 'text/plain') {
            extractedText = buffer.toString('utf-8');
        } else if (mimeType.includes('wordprocessingml')) {
            // استخراج متن از docx
            const result = await mammoth.extractRawText({ buffer: buffer });
            extractedText = result.value;
        }

        if (!extractedText || extractedText.trim().length === 0) {
            return ctx.reply('فایل خالی است یا متنی قابل خواندن ندارد.');
        }

        // خلاصه کردن
        const summary = await summarizeText(extractedText);

        // ارسال نتیجه
        await ctx.telegram.editMessageText(ctx.chat.id, waitingMsg.message_id, null, 
            `📝 **خلاصه فایل شما:**\n\n${summary}`, 
            { parse_mode: 'Markdown' }
        );

        // دکمه‌های دانلود
        await ctx.reply('انتخاب فرمت خروجی:', 
            Markup.inlineKeyboard([
                [Markup.button.callback('📄 دانلود TXT', 'get_txt')],
                [Markup.button.callback('📘 دانلود DOCX', 'get_doc')]
            ])
        );

    } catch (error) {
        console.error(error);
        ctx.reply('خطایی در پردازش فایل رخ داد.');
    }
});

// مدیریت دکمه دانلود TXT
bot.action('get_txt', async (ctx) => {
    // نکته: ما خلاصه را از متن پیام قبلی که دکمه به آن چسبیده یا ریپلای شده برمی‌داریم
    // اما چون دکمه در پیام جداگانه است، باید به پیام قبل از دکمه دسترسی داشته باشیم.
    // راه ساده‌تر: در Vercel حافظه نداریم، پس متن خلاصه را دوباره از پیام چت برمی‌داریم.
    
    // اینجا فرض می‌کنیم کاربر بلافاصله دکمه را زده و پیام قبلی (reply_to_message) یا پیام بالاتر همان خلاصه است.
    // برای سادگی در نسخه Serverless، ما متن دکمه را ادیت می‌کنیم چون دسترسی به استیت نداریم.
    // *روش حرفه‌ای تر برای Serverless*: متن خلاصه را داخل دکمه‌ها ذخیره نمی‌کنیم چون محدودیت کاراکتر دارد.
    // راهکار: متن خلاصه در پیامِ قبل از دکمه‌ها موجود است.
    
    // دریافت پیام خلاصه (فرض می‌کنیم پیام بالای دکمه، پیام خلاصه است)
    // در تلگرام بات API، پیدا کردن پیام قبلی سخت است.
    // ترفند: ما متن خلاصه را به کاربر نشان دادیم. کاربر می‌تواند آن را کپی کند.
    // اما برای "تولید فایل"، ما نیاز به متن داریم.
    
    // *راه حل جایگزین:* متن را به صورت فایل ارسال می‌کنیم.
    // چون در محیط Serverless متغیرها پاک می‌شوند، ما نمی‌توانیم `lastSummary` را نگه داریم.
    // بهترین راه برای این پروژه آموزشی: از کاربر بخواهیم اگر فایل می‌خواهد، روی متن خلاصه "Reply" کند و دستور /txt یا /docx بدهد.
    // اما چون دکمه خواستید: ما تلاش می‌کنیم پیامِ حاویِ خلاصه را پیدا کنیم.
    
    // اصلاحیه برای تجربه کاربری بهتر در Serverless:
    // ما متن را نداریم. پس پیامی به کاربر می‌دهیم.
    
    ctx.answerCbQuery();
    ctx.reply('⚠️ به دلیل محدودیت‌های سرور، لطفاً متن خلاصه شده را کپی کرده و در یک فایل ذخیره کنید، یا متن خلاصه شده را "Reply" (پاسخ) کرده و دستور /doc را بفرستید تا فایل Word بسازم.');
});

// دستور تبدیل ریپلای به فایل Word (چون در Serverless دکمه‌ها حافظه ندارند)
bot.command('doc', async (ctx) => {
    if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.text) {
        return ctx.reply('لطفاً این دستور را روی متن خلاصه شده "Reply" (پاسخ) کنید.');
    }

    const summaryText = ctx.message.reply_to_message.text;
    const cleanText = summaryText.replace('📝 **خلاصه متن:**', '').trim();

    // ساخت فایل Word
    const doc = new Document({
        sections: [{
            properties: {},
            children: [
                new Paragraph({
                    children: [
                        new TextRun({
                            text: "خلاصه متن",
                            bold: true,
                            size: 32,
                            rightToLeft: true
                        }),
                    ],
                }),
                new Paragraph({
                    children: [
                        new TextRun({
                            text: cleanText,
                            size: 24,
                            rightToLeft: true
                        }),
                    ],
                }),
            ],
        }],
    });

    const buffer = await Packer.toBuffer(doc);
    
    ctx.replyWithDocument({ source: buffer, filename: 'summary.docx' });
});

bot.command('txt', async (ctx) => {
    if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.text) {
        return ctx.reply('لطفاً این دستور را روی متن خلاصه شده "Reply" (پاسخ) کنید.');
    }
    
    const summaryText = ctx.message.reply_to_message.text;
    const cleanText = summaryText.replace('📝 **خلاصه متن:**', '').trim();
    
    ctx.replyWithDocument({ source: Buffer.from(cleanText, 'utf-8'), filename: 'summary.txt' });
});

// هندلر اصلی برای Vercel
module.exports = async (req, res) => {
    try {
        // اطمینان از اینکه درخواست POST است
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body);
            res.status(200).send('OK');
        } else {
            res.status(200).send('Bot is running!');
        }
    } catch (e) {
        console.error(e);
        res.status(500).send('Error');
    }
};
