# Shift Settings Integration Guide
## كيف تم ربط Shift Settings بالجدول لكلا الفريقين

## 📋 المشكلة الأصلية

المستخدم وصف المشكلة:
> "مفيش اكن shift setting منفصله اي الحل ناقش معايا ازاي نربط shift setting بحيث اي تعديل يسمع ف جنريشن ع كلا التيمين"

**الترجمة**: "Shift Settings منفصلة، كيف نربط Shift Settings بحيث أي تعديل يطبق على كلا الفريقين؟"

المشكلة الأساسية:
- Shift Settings لا يعمل كـ "Dynamo" يتحكم في كل شيء
- تغييرات Shift Settings لا تؤثر على Total Hours في Helpdesk
- تغييرات Shift Settings لا تؤثر على Total Hours في Connection Team
- `isHoliday` flag في database entries لا يتم تحديثه بشكل صحيح

---

## ✅ الحل المطبق: Settings-Driven Approach

### المفهوم الأساسي

**Shift Settings هو المصدر الأساسي للحقيقة (Single Source of Truth)**

بدلاً من الاعتماد على `isHoliday` flag في database entries، نحدد حالة العطلة ديناميكياً من `settings.holidays` في كل مرة نحسب فيها الساعات.

---

## 🔧 التغييرات البرمجية

### 1. تحديث `recalcScheduleHours` في `src/lib/scheduler.ts`

**قبل التغيير**:
```typescript
// كان يستخدم isHoliday flag من entry
if (entry.isHoliday) {
  const holidayDeductionHours = settings.holidayHours?.[entry.date] ?? 0;
  // ...
}
```

**بعد التغيير**:
```typescript
// يحدد حالة العطلة ديناميكياً من settings.holidays
const holidaySet = new Set(settings.holidays || []);
const isHolidayDynamic = holidaySet.has(entry.date);

if (isHolidayDynamic) {
  const holidayDeductionHours = settings.holidayHours?.[entry.date] ?? 0;
  return {
    ...entry,
    start: zeroShift.start,
    end: zeroShift.end,
    hours: holidayDeductionHours,
    isHoliday: isHolidayDynamic, // تحديث الـ flag ليتطابق مع settings
  };
}
```

**الفائدة**:
- لا نعتمد على `isHoliday` flag في الـ database
- نحدد حالة العطلة ديناميكياً من `settings.holidays`
- أي تغيير في Settings يطبق فوراً على جميع entries

---

### 2. تحديث `POST /api/settings` في `src/app/api/settings/route.ts`

**التغييرات الرئيسية**:

1. **إعادة حساب ALL entries عند حفظ Settings**:
```typescript
// IMPORTANT: Recalculate ALL schedule entries with new settings
const allDbEntries = await db.scheduleEntry.findAll();

if (allDbEntries.length > 0) {
  const settingsObj: import("@/lib/scheduler").Settings = {
    shifts: JSON.parse(result.shifts),
    weekStart: result.weekStart,
    holidays: JSON.parse(result.holidays),
    holidayHours: JSON.parse(result.holidayHours),
    summerTime: result.summerTime,
    summerShifts: JSON.parse(result.summerShifts),
    dayHours: JSON.parse(result.dayHours || "{}"),
  };

  // Reset isHoliday - will be recalculated
  const schedulerEntries = allDbEntries.map(e => ({
    ...e,
    isHoliday: false, // إعادة تعيين - سيتم إعادة حسابه
  }));

  const recalced = recalcScheduleHours(schedulerEntries, settingsObj);
  // حفظ التغييرات في database
  await db.scheduleEntry.updateHoursBatch(batchUpdates);
}
```

**الفائدة**:
- أي تغيير في Shift Settings يعيد حساب جميع entries
- `isHoliday` flag يتم تحديثه في database ليتطابق مع settings
- Frontend يحصل على بيانات محدثة عند الاستعلام

---

## 🎯 كيف يعمل النظام الآن

### تدفق البيانات (Data Flow)

```
1. المستخدم يغير Shift Settings (يضيف عطلة)
   ↓
2. POST /api/settings
   ↓
3. حفظ Settings في database
   ↓
4. إعادة حساب ALL entries بـ recalcScheduleHours
   - تحديد حالة العطلة من settings.holidays
   - حساب hours بناءً على holidayHours
   ↓
5. تحديث database entries (isHoliday, hours)
   ↓
6. Frontend يستدعي fetchScheduleEntries() و fetchConnectionTeam()
   ↓
7. Helpdesk Total Hours محدث ✓
8. Connection Team Total Hours محدث ✓
```

---

## 📊 حساب ساعات Connection Team

الـ Connection Team يحسب ساعاته بطريقة مختلفة (client-side):

```typescript
// في src/app/page.tsx
const calcConnectionWeekHours = (weekStart: string, weekEnd: string): number => {
  if (!settings) return 0;
  let total = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // Check if this is a holiday
    const isHol = settings.holidays?.includes(dateStr) || false;
    if (isHol) {
      // Use custom holiday hours deduction
      if (settings.holidayHours && settings.holidayHours[dateStr] !== undefined) {
        const deductionHours = settings.holidayHours[dateStr];
        total += deductionHours;
      }
      // Otherwise, skip (0 hours)
      continue;
    }
    // ... حساب ساعات الأيام العادية
  }

  return total;
};
```

**الفائدة**:
- Connection Team يستخدم `settings.holidays` مباشرة
- أي تغيير في settings يطبق فوراً (reactive)
- لا يحتاج database update

---

## 🔄 سيناريو استخدام عملي

### سيناريو 1: إضافة يوم عطلة جديد

1. **المستخدم** يفتح Shift Settings
2. **يختار** يوم (مثلاً: 2026-04-15)
3. **يحدد** عدد ساعات الخصم (مثلاً: 9 ساعات)
4. **يضغط** Save Settings

**ما يحدث خلف الكواليس**:
```
POST /api/settings
├─ حفظ holidays: ["2026-04-15", ...]
├─ حفظ holidayHours: {"2026-04-15": 9, ...}
├─ إعادة حساب ALL entries
│   ├─ entry for 2026-04-15 → isHoliday: true, hours: 9
│   └─ entries أخرى → no change
├─ تحديث database entries
└─ Frontend fetchScheduleEntries() → Total Hours محدث
```

**النتيجة**:
- ✅ Helpdesk Total Hours محدث (خصم 9 ساعات)
- ✅ Connection Team Total Hours محدث (خصم 9 ساعات)
- ✅ Day 2026-04-15 يظهر بـ "HOL" badge

---

### سيناريو 2: إزالة يوم عطلة

1. **المستخدم** يفتح Shift Settings
2. **يزيل** يوم (مثلاً: 2026-04-15)
3. **يضغط** Save Settings

**ما يحدث خلف الكواليس**:
```
POST /api/settings
├─ حفظ holidays: [] (بدون 2026-04-15)
├─ حفظ holidayHours: {} (بدون 2026-04-15)
├─ إعادة حساب ALL entries
│   ├─ entry for 2026-04-15 → isHoliday: false, hours: 5 (weekday)
│   └─ entries أخرى → no change
├─ تحديث database entries
└─ Frontend fetchScheduleEntries() → Total Hours محدث
```

**النتيجة**:
- ✅ Helpdesk Total Hours محدث (إضافة 5 ساعات)
- ✅ Connection Team Total Hours محدث (إضافة 5 ساعات)
- ✅ Day 2026-04-15 يظهر بـ "WD" badge (weekday)

---

## 🎨 UI Integration

### Shift Settings Dialog

يحتوي على:
- **Holidays Section**:
  - قائمة بأيام العطلات
  - زر Toggle Holiday لكل يوم
  - حقل input لعدد ساعات الخصم (auto-fill بناءً على يوم الأسبوع)
- **Shift Times Section**:
  - أوقات الوردية لكل يوم (Weekday, Thursday, Friday, Saturday)
  - Summer Time option

### كيفية الاستخدام

1. افتح **Shift Settings** من زر ⚙️ Settings
2. في قسم **Holidays**:
   - اضغط **Add Holiday** لإضافة يوم عطلة جديد
   - حدد التاريخ من calendar
   - عدد الساعات سيُملأ تلقائياً (9 ساعات لـ Friday/Saturday، 5 ساعات للأيام الأخرى)
   - يمكنك تعديل عدد الساعات يدوياً
   - اضغط **Toggle Holiday** لإضافة/إزالة العطلة
3. اضغط **Save Settings**

---

## 🔍 Debugging Tips

### سجلات Console

عند تغيير Shift Settings، تحقق من logs التالية:

```typescript
// في Settings API
[Settings API] POST request: { holidaysCount: 1, holidayHoursKeys: ["2026-04-15"] }
[Settings API] Saved to DB - holiday_hours: "{\"2026-04-15\":9}"
[Settings API] Total entries in DB: 30
[Settings API] Settings loaded: { holidays: ["2026-04-15"], holidayHours: {"2026-04-15":9} }
[Settings API] Entries before recalc: [{date: "2026-04-15", hours: 5, isHoliday: false}]
[Settings API] Entries after recalc: [{date: "2026-04-15", hours: 9, isHoliday: true}]
[Settings API] Batch updates needed: 1
[Settings API] Sample updates: [{id: 15, ...}]

// في Frontend
[recalcScheduleHours] Holiday 2026-04-15: { isHolidayDynamic: true, holidayDeductionHours: 9 }
[calcConnectionWeekHours] Holiday 2026-04-15: deducting 9h
[Total Hours Calculation] { totalHours: 145, holidayEntriesInMonth: [{date: "2026-04-15", hours: 9}] }
```

---

## 📝 الخلاصة

### ما تم تحقيقه

✅ **Shift Settings هو الـ Dynamo الذي يحرك الجدول**:
- أي تغيير في Settings يعيد حساب جميع entries
- Helpdesk و Connection Team يتأثران بتغييرات Settings
- Frontend يحصل على بيانات محدثة تلقائياً

✅ **تحديد حالة العطلة ديناميكاً**:
- لا نعتمد على `isHoliday` flag في database
- نحدد حالة العطلة من `settings.holidays`
- أي تغيير في holidays list يطبق فوراً

✅ **خصم ساعات العطلات بشكل صحيح**:
- كل يوم عطلة له عدد ساعات خصم خاص
- Auto-fill بناءً على يوم الأسبوع (Friday/Saturday = 9 ساعات، الأيام الأخرى = 5 ساعات)
- يمكن تعديل عدد الساعات يدوياً لكل يوم

---

## 🚀 Future Improvements

1. **Real-time Updates**: استخدام WebSocket لتحديث البيانات تلقائياً لجميع المستخدمين المتصلين
2. **Audit Log**: تسجيل جميع التغييرات في Shift Settings
3. **Holiday Presets**: حفظ مجموعات من العطلات (National Holidays, Company Holidays)
4. **Bulk Actions**: إضافة/إزالة عدة عطلات دفعة واحدة

---

## 📞 Support

إذا واجهت أي مشاكل:
1. تحقق من سجلات Console في browser DevTools
2. تحقق من سجلات Settings API في terminal
3. تأكد أن `fetchScheduleEntries()` و `fetchConnectionTeam()` يتم استدعاؤهما بعد حفظ Settings

---

**تم إنشاء هذا المستند بتاريخ**: 2025-01-24
**الإصدار**: v1.0
**المطور**: Z.ai Code Assistant
