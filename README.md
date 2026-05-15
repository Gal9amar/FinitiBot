# 🎂 finitistar Birthday Bot

בוט טלגרם שמייצר כרטיסי יום הולדת אוטומטית עם תמונה ושם על הטמפלייט של finitistar.

## הגדרה ראשונית

### 1. צור בוט טלגרם
- פתח [@BotFather](https://t.me/BotFather) בטלגרם
- שלח `/newbot`
- בחר שם לבוט
- העתק את ה-**BOT_TOKEN**

### 2. קבל מפתח remove.bg
- הירשם ב-[remove.bg](https://www.remove.bg/api)
- גש ל-API Keys
- צור מפתח חדש (50 תמונות/חודש חינם)

### 3. הגדרת `.env`
```bash
cp .env.example .env
```
ערוך את `.env`:
```
BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
REMOVE_BG_API_KEY=your_key_here
```

### 4. התקנה והפעלה
```bash
npm install
npm start
```

## פריסה על Railway (מומלץ)

1. צור חשבון ב-[railway.app](https://railway.app)
2. `New Project` → `Deploy from GitHub repo`
3. הוסף את משתני הסביבה (BOT_TOKEN, REMOVE_BG_API_KEY)
4. Railway יפעיל את הבוט אוטומטית

## שימוש בבוט

1. שלח תמונה של האדם
2. הבוט ישאל לשם
3. שלח את השם
4. קבל כרטיס מוכן תוך ~10 שניות 🎉

## כיוונון עמדות

אם צריך לשנות מיקום התמונה/שם, ערוך ב-`bot.js`:

```js
const PERSON_REGION = {
  left: 1050,   // X מהשמאל
  top: 0,       // Y מלמעלה
  width: 870,   // רוחב
  height: 1080  // גובה
};

const NAME_CONFIG = {
  x: 40,        // X מהשמאל
  y: 870,       // Y מלמעלה
  fontSize: 200,
  fontColor: '#1a3faa'
};
```
