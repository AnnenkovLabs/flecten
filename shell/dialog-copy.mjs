/** Native close confirmation uses the renderer's validated interface locale. */
const copies = {
  en: { title: "Unsaved files", message: "There are unsaved changes in the IDE.", buttons: ["Keep working", "Close without saving"] },
  "zh-Hans": { title: "未保存的文件", message: "编辑器中有未保存的更改。", buttons: ["继续编辑", "不保存并关闭"] },
  "pt-BR": { title: "Arquivos não salvos", message: "Há alterações não salvas no editor.", buttons: ["Continuar editando", "Fechar sem salvar"] },
  es: { title: "Archivos sin guardar", message: "Hay cambios sin guardar en el editor.", buttons: ["Seguir editando", "Cerrar sin guardar"] },
  ja: { title: "未保存のファイル", message: "エディターに未保存の変更があります。", buttons: ["編集を続ける", "保存せずに閉じる"] },
  uk: { title: "Незбережені файли", message: "У редакторі є незбережені зміни.", buttons: ["Продовжити роботу", "Закрити без збереження"] },
  ru: { title: "Несохранённые файлы", message: "В редакторе есть несохранённые изменения.", buttons: ["Продолжить работу", "Закрыть без сохранения"] },
};

export function dialogCopy(locale) {
  return Object.hasOwn(copies, locale) ? copies[locale] : copies.en;
}

export function isDialogLocale(value) {
  return typeof value === "string" && Object.hasOwn(copies, value);
}

export function registerLocaleIpc(ipcMain, isTrusted, onLocale) {
  ipcMain.on("window:locale", (event, locale) => {
    if (isTrusted(event) && isDialogLocale(locale)) onLocale(locale);
  });
}

export function registerCloseConfirmation(win, dialog, locale) {
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      ...dialogCopy(locale()),
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (choice === 1) event.preventDefault();
  });
}
