# Tizandish Image Studio — v3.4.0 (preview branch)

نسخهٔ آزمایشی 3.4.0؛ این شاخه هنوز با main ادغام یا روی production منتشر نشده است.

## تغییرات نسخه 3.4.0
- شکست موتور AI دیگر به‌صورت خودکار با پردازش کلاسیک پنهان نمی‌شود؛ وضعیت خطا صریح است و کاربر باید آگاهانه حالت کلاسیک را انتخاب کند.
- API تغییر زاویه از مسیر امن هم‌مبدأ `/api/viewpoint` عبور می‌کند؛ کلید ارائه‌دهنده در مرورگر قرار نمی‌گیرد.
- درگاه API از Pollinations Image Edits استفاده می‌کند و مدل از طریق متغیر محرمانه `POLLINATIONS_IMAGE_MODEL` انتخاب می‌شود.
- اعتبارسنجی نوع/حجم تصویر، طول پرامپت، مبدأ درخواست، timeout و پاسخ تصویری اضافه شده است.
- تست واحد API، بررسی syntax اسکریپت‌های HTML و آزمون مرورگر موبایل برای ورود تصویر، پردازش کلاسیک، مقایسهٔ قبل/بعد و helper برش اضافه شده‌اند.

## راه‌اندازی API تغییر زاویه در Vercel
در Project Settings → Environment Variables این مقادیر را فقط برای Preview/Production موردنظر تنظیم کنید:
- `POLLINATIONS_API_KEY`: کلید محرمانهٔ Pollinations
- `POLLINATIONS_IMAGE_MODEL`: شناسهٔ دقیق مدل image-edit که در کاتالوگ Pollinations پشتیبانی و برای حساب شما فعال است
- `VIEWPOINT_ALLOWED_ORIGINS`: اختیاری؛ مبدأهای اضافی مجاز، جداشده با کاما

پس از تنظیم متغیرها، یک Preview deployment جدید بسازید. کلید را هرگز در HTML، GitHub یا چت قرار ندهید.

**هزینه:** گزینهٔ «free» به معنی رایگانِ نامحدود نیست. Pollinations ممکن است برای استفاده به کلید و اعتبار حساب نیاز داشته باشد؛ قیمت/دسترسی مدل را قبل از استفاده بررسی کنید. در این شاخه هیچ کلید یا اعتبار پولی مصرف نشده است.

## آزمون‌ها
```bash
node --test tests/viewpoint-api.test.cjs
node tests/check-inline-script.cjs
npm install --no-save playwright
npx playwright install chromium
node tests/browser-v3.4.mjs
```

آزمون مرورگر واقعی، پردازش کلاسیک و کنترل‌های رابط را بررسی می‌کند. اجرای واقعی inference مدل IMG.LY و سرویس Pollinations به شبکه، سخت‌افزار و کلید معتبر نیاز دارد و در CI بدون اسرار کاربر اجرا نمی‌شود؛ بنابراین تست‌های mock یا unit به‌عنوان inference زنده گزارش نمی‌شوند.

## وضعیت انتشار
این شاخه برای بازبینی و تست است. هیچ merge یا production deployment در این تغییرات انجام نشده است.
