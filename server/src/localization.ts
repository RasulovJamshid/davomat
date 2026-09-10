import type { Request } from "express";

export type ApiLocale = "en" | "uz" | "ru";

const messages: Record<ApiLocale, Record<string, string>> = {
  en: {},
  uz: {
    "Authentication required": "Tizimga kirish talab qilinadi",
    "Manager access required": "Menejer huquqi talab qilinadi",
    "Invalid email or password": "Email yoki parol noto‘g‘ri",
    "Session expired or invalid": "Sessiya tugagan yoki yaroqsiz",
    "User account is no longer active": "Foydalanuvchi hisobi endi faol emas",
    "User is no longer active": "Foydalanuvchi endi faol emas",
    "Current password is incorrect": "Joriy parol noto‘g‘ri",
    "This reset link is invalid or has expired":
      "Parolni tiklash havolasi yaroqsiz yoki muddati tugagan",
    "Validation failed": "Kiritilgan ma’lumotlar tekshiruvdan o‘tmadi",
    "Department not found": "Bo‘lim topilmadi",
    "Employee not found": "Xodim topilmadi",
    "Location not found": "Joylashuv topilmadi",
    "Clock event not found": "Vaqt hodisasi topilmadi",
    "Payroll period not found": "Ish haqi davri topilmadi",
    "Payslip not found": "Hisob varaqasi topilmadi",
    "Active shift not found": "Faol smena topilmadi",
    "Pending exception not found": "Kutilayotgan istisno topilmadi",
    "This shift overlaps an existing assignment":
      "Bu smena mavjud topshiriq bilan ustma-ust tushadi",
    "A record with these values already exists":
      "Bu qiymatlarga ega yozuv allaqachon mavjud",
    "An unexpected server error occurred":
      "Serverda kutilmagan xatolik yuz berdi",
    "Paid payroll cannot be recalculated":
      "To‘langan ish haqini qayta hisoblab bo‘lmaydi",
    "Paid payroll attendance cannot be changed":
      "To‘langan davr davomatini o‘zgartirib bo‘lmaydi",
    "Employee access required": "Xodim huquqi talab qilinadi",
    "No active employee profile is linked to this account":
      "Bu hisobga faol xodim profili bog‘lanmagan",
    "Too many sign-in attempts. Try again later":
      "Kirish urinishlari juda ko‘p. Keyinroq qayta urinib ko‘ring",
    "Too many recovery attempts. Try again later":
      "Tiklash urinishlari juda ko‘p. Keyinroq qayta urinib ko‘ring",
    "Invalid work location": "Ish manzili noto‘g‘ri",
    "No active employees match this scope":
      "Bu tanlovga mos faol xodimlar topilmadi",
    "This account is already linked to another mobile device":
      "Bu hisob boshqa mobil qurilmaga bog‘langan",
    "This mobile device is already linked to another account":
      "Bu mobil qurilma boshqa hisobga bog‘langan",
    "A valid attendance selfie is required":
      "Davomat uchun yaroqli selfi talab qilinadi",
    "Take a new selfie immediately before recording attendance":
      "Davomatni qayd etishdan oldin yangi selfi oling",
    "No mobile device is linked to this employee":
      "Bu xodimga mobil qurilma bog‘lanmagan",
    "Attendance selfie not found": "Davomat selfisi topilmadi",
    "The mobile app is only available to employees":
      "Mobil ilova faqat xodimlar uchun mavjud",
    "Live location update is no longer current":
      "Jonli joylashuv ma'lumoti eskirgan",
    "An active employee profile is required":
      "Faol xodim profili talab qilinadi",
    "Live location is not enabled for an active shift":
      "Faol smena uchun jonli joylashuv yoqilmagan",
  },
  ru: {
    "Authentication required": "Требуется авторизация",
    "Manager access required": "Требуются права менеджера",
    "Invalid email or password": "Неверный email или пароль",
    "Session expired or invalid": "Сессия истекла или недействительна",
    "User account is no longer active":
      "Учетная запись пользователя больше не активна",
    "User is no longer active": "Пользователь больше не активен",
    "Current password is incorrect": "Текущий пароль указан неверно",
    "This reset link is invalid or has expired":
      "Ссылка для сброса пароля недействительна или истекла",
    "Validation failed": "Введенные данные не прошли проверку",
    "Department not found": "Отдел не найден",
    "Employee not found": "Сотрудник не найден",
    "Location not found": "Локация не найдена",
    "Clock event not found": "Событие учета времени не найдено",
    "Payroll period not found": "Расчетный период не найден",
    "Payslip not found": "Расчетный лист не найден",
    "Active shift not found": "Активная смена не найдена",
    "Pending exception not found": "Ожидающее исключение не найдено",
    "This shift overlaps an existing assignment":
      "Эта смена пересекается с существующим назначением",
    "A record with these values already exists":
      "Запись с такими значениями уже существует",
    "An unexpected server error occurred":
      "Произошла непредвиденная ошибка сервера",
    "Paid payroll cannot be recalculated":
      "Оплаченный расчет нельзя пересчитать",
    "Paid payroll attendance cannot be changed":
      "Посещаемость оплаченного периода нельзя изменить",
    "Employee access required": "Требуется доступ сотрудника",
    "No active employee profile is linked to this account":
      "К этой учетной записи не привязан активный профиль сотрудника",
    "Too many sign-in attempts. Try again later":
      "Слишком много попыток входа. Повторите позже",
    "Too many recovery attempts. Try again later":
      "Слишком много попыток восстановления. Повторите позже",
    "Invalid work location": "Недопустимая рабочая локация",
    "No active employees match this scope":
      "Для выбранной области нет активных сотрудников",
    "This account is already linked to another mobile device":
      "Эта учетная запись уже привязана к другому мобильному устройству",
    "This mobile device is already linked to another account":
      "Это мобильное устройство уже привязано к другой учетной записи",
    "A valid attendance selfie is required":
      "Требуется действительное селфи для учета посещаемости",
    "Take a new selfie immediately before recording attendance":
      "Сделайте новое селфи непосредственно перед отметкой посещаемости",
    "No mobile device is linked to this employee":
      "К этому сотруднику не привязано мобильное устройство",
    "Attendance selfie not found": "Селфи посещаемости не найдено",
    "The mobile app is only available to employees":
      "Мобильное приложение доступно только сотрудникам",
    "Live location update is no longer current":
      "Данные геолокации устарели",
    "An active employee profile is required":
      "Требуется активный профиль сотрудника",
    "Live location is not enabled for an active shift":
      "Геолокация не включена для активной смены",
  },
};

const fallback: Record<Exclude<ApiLocale, "en">, string> = {
  uz: "So‘rovni bajarib bo‘lmadi",
  ru: "Не удалось выполнить запрос",
};

export function requestLocale(request: Request): ApiLocale {
  const raw = String(request.headers["accept-language"] ?? "en").toLowerCase();
  return raw.startsWith("uz") ? "uz" : raw.startsWith("ru") ? "ru" : "en";
}

export function localize(request: Request, message: string): string {
  const locale = requestLocale(request);
  if (locale === "en") return message;
  return messages[locale][message] ?? fallback[locale];
}

export function invalidFieldMessage(request: Request): string {
  const locale = requestLocale(request);
  return locale === "uz"
    ? "Noto‘g‘ri qiymat"
    : locale === "ru"
      ? "Недопустимое значение"
      : "Invalid value";
}
