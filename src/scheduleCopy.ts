import type { Locale } from "./i18n";
const copy: Record<string, [string, string, string]> = {
  weekly: ["Weekly schedules", "Повторяющиеся графики", "Haftalik jadvallar"],
  title: [
    "Set your workweek once",
    "Настройте рабочую неделю один раз",
    "Ish haftasini bir marta sozlang",
  ],
  help: [
    "Choose days and hours for everyone or a group. Shifts are published automatically and continue every week until you change or pause the schedule.",
    "Выберите дни и часы для всех или группы сотрудников. Смены публикуются автоматически каждую неделю, пока вы не измените или не приостановите график.",
    "Barcha xodimlar yoki guruh uchun kun va vaqtni tanlang. Jadval oʻzgartirilmaguncha yoki toʻxtatilmaguncha smenalar har hafta avtomatik eʼlon qilinadi.",
  ],
  add: ["Set weekly schedule", "Настроить график", "Haftalik jadvalni sozlash"],
  edit: ["Edit schedule", "Изменить график", "Jadvalni tahrirlash"],
  everyone: ["Everyone", "Все сотрудники", "Barcha xodimlar"],
  department: ["Department", "Отдел", "Boʻlim"],
  location: ["Location", "Локация", "Ish joyi"],
  employee: ["One employee", "Один сотрудник", "Bitta xodim"],
  who: [
    "Who works this schedule?",
    "Для кого этот график?",
    "Bu jadval kim uchun?",
  ],
  choose: ["Choose…", "Выберите…", "Tanlang…"],
  days: ["Working days", "Рабочие дни", "Ish kunlari"],
  from: ["Starts on", "Действует с", "Boshlanish sanasi"],
  starts: ["Start time", "Начало работы", "Ish boshlanishi"],
  ends: ["End time", "Окончание работы", "Ish tugashi"],
  details: [
    "Breaks, location and end date",
    "Перерыв, локация и дата окончания",
    "Tanaffus, joy va tugash sanasi",
  ],
  break: [
    "Unpaid break (minutes)",
    "Неоплачиваемый перерыв (мин)",
    "Toʻlanmaydigan tanaffus (daqiqa)",
  ],
  grace: [
    "Lateness allowance (minutes)",
    "Допуск опоздания (мин)",
    "Kechikish chegarasi (daqiqa)",
  ],
  until: [
    "End date (optional)",
    "Дата окончания (необязательно)",
    "Tugash sanasi (ixtiyoriy)",
  ],
  assigned: [
    "Use each employee’s assigned location",
    "Основная локация каждого сотрудника",
    "Har bir xodimning ish joyi",
  ],
  activate: ["Save & activate", "Сохранить и включить", "Saqlash va yoqish"],
  saving: ["Saving…", "Сохранение…", "Saqlanmoqda…"],
  cancel: ["Cancel", "Отмена", "Bekor qilish"],
  pause: ["Pause", "Приостановить", "Toʻxtatish"],
  resume: ["Activate", "Включить", "Yoqish"],
  running: [
    "Repeats automatically",
    "Повторяется автоматически",
    "Avtomatik takrorlanadi",
  ],
  paused: ["Paused", "Приостановлен", "Toʻxtatilgan"],
  imported: [
    "Saved template · activate to repeat",
    "Сохраненный шаблон · включите повторение",
    "Saqlangan andoza · takrorlashni yoqing",
  ],
  empty: [
    "No weekly schedule yet",
    "Повторяющийся график не настроен",
    "Haftalik jadval hali yoʻq",
  ],
  preview: ["Every week", "Каждую неделю", "Har hafta"],
  forever: [
    "Until you change or pause it",
    "Пока вы не измените или не приостановите его",
    "Oʻzgartirmaguningizcha yoki toʻxtatmaguningizcha",
  ],
  exception: [
    "Individual schedules override group schedules. Edited shifts and cancelled days stay as exceptions. New employees matching the group are included automatically.",
    "Индивидуальный график имеет приоритет над групповым. Измененные смены и отмененные дни сохраняются как исключения. Новые сотрудники группы добавляются автоматически.",
    "Shaxsiy jadval guruh jadvalidan ustun. Oʻzgartirilgan smenalar va bekor qilingan kunlar saqlanadi. Guruhdagi yangi xodimlar avtomatik qoʻshiladi.",
  ],
  pausedHint: [
    "Future untouched automatic shifts will be removed. Started work and manual changes will be kept.",
    "Будущие автоматические смены без ручных изменений будут отменены. Начатые смены и ручные изменения сохранятся.",
    "Kelajakdagi oʻzgartirilmagan avtomatik smenalar bekor qilinadi. Boshlangan ish va qoʻlda oʻzgartirishlar saqlanadi.",
  ],
  saved: [
    "Schedule active. Published shifts created:",
    "График включен. Опубликовано смен:",
    "Jadval yoqildi. Eʼlon qilingan smenalar:",
  ],
  preserved: [
    "Existing shifts and exceptions kept:",
    "Сохранено существующих смен и исключений:",
    "Saqlangan smenalar va istisnolar:",
  ],
  calendar: ["Calendar", "Календарь", "Taqvim"],
  calendarHelp: [
    "Use weekly schedules for regular work. Use the calendar to change one shift or add a one-off assignment.",
    "Настройте повторение для обычной рабочей недели. В календаре меняйте отдельные смены или добавляйте разовые.",
    "Muntazam ish uchun haftalik jadvalni sozlang. Taqvimda alohida smenani oʻzgartiring yoki bir martalik smena qoʻshing.",
  ],
  moved: [
    "Weekly schedules now live in Schedule",
    "Повторяющиеся графики теперь в разделе «График»",
    "Haftalik jadvallar endi Jadval boʻlimida",
  ],
  open: ["Open Schedule", "Открыть график", "Jadvalni ochish"],
  calendarException: ["One-off shift", "Разовая смена", "Bir martalik smena"],
  find: ["Find a section…", "Найти раздел…", "Boʻlimni qidirish…"],
  generated: [
    "Calendar maintained through",
    "Календарь заполнен до",
    "Taqvim shu sanagacha toʻldirilgan",
  ],
  name: ["Schedule name", "Название графика", "Jadval nomi"],
};
export function scheduleText(locale: Locale, key: string) {
  return copy[key]?.[locale === "ru" ? 1 : locale === "uz" ? 2 : 0] ?? key;
}
