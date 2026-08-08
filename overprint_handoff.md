# Overprint Preview — Handoff для разработчика

> Статус: все фазы 0–5 реализованы, задеплоено на GitHub Pages (https://shafranek-js.github.io/CartonBuilder/).
> Дата: 2026-08-08. Содержит: архитектуру, ключевые технические факты, историю фиксов, известные проблемы и рецепты отладки.

---

## 1. Что сделано

Замена рендера PDF/AI с pdf.js на **MuPDF.js** (mupdf@1.28.0, зафиксирован `--save-exact`) с **симуляцией overprint** через собственный WASM-билд mupdf.

Фазы:
- **0. Capability spike** — доказано, что stock mupdf НЕ симулирует overprint; решение — кастомный WASM. Отчёт: `docs/10.mupdf-capability-spike.md`.
- **1. Базовый рендерер** — worker, протокол, кэш, планировщик, загрузка PDF/AI, слои OCG, пароли, page box.
- **2. Отмена рендеров + пароли + memory-lifecycle.**
- **3. Тайлинговый рендер** (2048px тайлы, overscan 1) + лимиты + watchdog.
- **4. Custom WASM** — overprint-рендер (mode 0/1/2) + CMYK→RGB.
- **5. Сепарации** — имена, покрытие, показ/скрытие плашек.

Спецификация: `docs/11. mupdf-overprint-runtime-specification.md`.

---

## 2. Архитектура рендера

```
src/artwork/pdfArtworkLoader.js      — импорт/рендер PDF через клиента
src/artwork/fileLoader.js            — маршрутизация файлов, renderPdfWithLayers
src/artwork/fileValidation.js        — определение типа, sha256
src/pdf-renderer/mupdfClient.js      — клиент: requestId-протокол, кэш, deduper, session-cancel, watchdog
src/pdf-renderer/mupdf.worker.js     — воркер: renderSingle / renderTiled, overprint, seps
src/pdf-renderer/custom/             — КАСТОМНЫЙ mupdf (mupdf.js, mupdf-wasm.js, mupdf-wasm.wasm ~10 МБ) — закоммичен
src/artwork/ArtworkApp.js            — UI-слой: тогл Overprint, диалог Separations, page box
src/artwork/artworkRasterizer.js     — растеризация превью/рендера (DPI, caps)
src/artwork/overprintSettings.js     — localStorage 'carton-builder-overprint'
src/ui/ViewMenu.js                   — пункт меню View → Overprint Preview / Separations…
```

### Поток рендера
1. Импорт: `loadArtworkFile` → (PDF/AI → `loadPdfArtwork`) → `client.openDocument(bytes, docId)`.
2. Рендер: `client.renderPage(docId, { scale, box, overprintMode, separationBehaviors })`.
3. Воркер: `handleRender` → если overprint (без behaviors) → **всегда `renderTiled`** (единый путь, см. §4); иначе `renderSingle` / `renderTiled` по порогу 2048px.
4. PNG-кодирование на клиенте (OffscreenCanvas).

### Режимы overprint
- `0` — выключено (обычный RGB-рендер).
- `1` — composite: реальные сепарации → COMPOSITE; без сепараций, но `fz_page_uses_overprint` → пустые сепарации (аналог `mutool -M 1`).
- `2` — spot: сепарации → SPOT (диалог Separations).

Ключевой факт: **overprint в mupdf работает только при DeviceCMYK-дестинации с сепарациями**.

---

## 3. Custom WASM (важно!)

- Готовые артефакты лежат в `src/pdf-renderer/custom/` — **они закоммичены и обязательны для работы** (fallback на stock mupdf = без overprint).
- Исходники/тулчейн: `scratch/mupdf-src/` (клон mupdf 1.28.0, в .gitignore), сборка — `scratch/build-mupdf-custom.sh`.
- Glue-функции в `scratch/mupdf-src/platform/wasm/lib/mupdf.c`:
  - `wasm_pdf_new_pixmap_from_page_with_usage_and_overprint[_imp]` (mode 0/1/2),
  - `wasm_pdf_new_pixmap_from_page_with_usage_and_overprint_behaviors` (для диалога сепараций),
  - `wasm_convert_cmyk_buffer_to_rgb` (CMYK→RGB буфера),
  - `wasm_pdf_page_separation_count/names/coverage`.
- TS-обёртки в `platform/wasm/lib/mupdf.ts` → сгенерированный `mupdf.js`.
- Тулчейн: Emscripten 4.0.8 (`C:\emsdk`), GNU make (scoop). Если правите glue — **пересобирайте wasm и коммитьте артефакты**.

---

## 4. Ключевые технические факты

- **Конкатенация матриц**: `JS Matrix.concat(a,b) = b·a` (a·b).
- `page.getBounds(box)` возвращает УЖЕ повёрнутый бокс; `page.getTransform()` — page_ctm (flip+rotate+crop-origin).
- Полный ctm для рендера: `concat(pageCtm, matrix)`, matrix = scale(+rotate(-rotation)).
- Тайлы: `planTiles` из `tileMath.js`; pixmap-строки со сдвигом `device_y = y0 + 1 + py`; тайлы 2048px с overscan 1 дают pixel-perfect стыки.
- **Tiled рендер использует display list**: `page.toDisplayList(true)` строится один раз, на каждый тайл — `displayList.run(device, matrix)` (вместо `page.run`) — контент парсится/декодируется один раз. Побайтово идентично single-рендеру (проверено).
- **Единый overprint-путь**: на любом размере рендера overprint идёт через `renderTiled` (CMYK-тайлы + `convertCmykToRgb`). Причина: single-путь (`toPixmapWithOverprint` + `toRgb`) на низких DPI давал сдвиг всего изображения (до 16% пикселей) из-за C-glue-конверсии; tiled-путь стабилен (0.1–0.4% на всех DPI).
- `device.close()` обязателен перед `device.destroy()` (иначе «dropping unclosed device»).
- Рендер лимитирован: `RENDER_MAX_PIXELS = 32_000_000` → `pdfRenderTooLarge`; страниц ≤ 5000; JS выключен.
- Watchdog клиента: `timeoutMs = 180_000` (было 60с — убивало рендеры больших файлов на слабых машинах).
- `vite.config.js`: `build.target` и `optimizeDeps.esbuildOptions.target` = `es2022` (mupdf использует top-level await).

---

## 5. Недавние фиксы (что и почему)

| Коммит | Что |
|---|---|
| `3f7f690` (первоначально `c7f2cfa`) | Вся MuPDF-работа, фазы 0–5 |
| `5a769b1` | Overprint-стабильность: `await` растеризации при импорте, проверка/повтор подписи растра после тогла, `device.close()` |
| `8f3926b` | es2022 для dev-оптимизатора (ошибка пребандла mupdf в dev) |
| `5c39dd2` | Display list в тайлинге + watchdog 60с→180с |
| `9843f35` | **Тогл overprint больше не откатывается при ошибке рендера** (возвращал `false` → ViewMenu снимал галочку); `loadPdfArtwork` теперь возвращает `sha256`; `validateProjectBundle` пересчитывает устаревший/отсутствующий хэш вместо отказа |
| `885751c` | **Единый tiled-путь для overprint на всех качествах** (см. §4) — убрал 16% артефакт на низких DPI |
| `9843f35` (доп.) | `loadPdfArtwork` возвращает `mimeType: 'application/pdf'`; `validateProjectBundle` корректирует устаревший mimeType (раньше .ai импорты могли хранить `file.type` браузера или fallback `'video/mp4'` → `projectArtworkTypeMismatch` при восстановлении автозахвата) |

**Механизм восстановления автозахвата**: IndexedDB хранит `{ snapshot, artworkBlobs, renderAssets }` (не ZIP!). `validateProjectBundle` проверяет: размер, тип, хэш — при устаревших метаданных (хэш/mimeType) **корректирует** их, а не отклоняет проект (целостность блоба гарантируют IndexedDB/ZIP-CRC).

---

## 6. Тестирование

```bash
npm run test:unit                          # 281 тестов
npx playwright test tests/e2e/overprint.spec.js tests/e2e/pdf-layers.spec.js   # 5 тестов
npm run test:e2e:smoke                     # smoke-набор
```

Тестовые файлы (в `test/`, не коммитятся):
- `test/test.pdf`, `test/test.ai` — минимальные артефакты с overprint (для быстрых проверок);
- `test/1082521_BTE M BUSCOPAN...Outlined.{pdf,ai}` — реальный производственный макет;
- `...Outlined.fixed.pdf` — PDF после `scripts/repair-pdf-flate.mjs`.

**Быстрая проверка консистентности overprint по DPI** (обязательно после правок рендера):
рендер страницы при 150 и 600 DPI (через `rasterizeArtwork`), сравнить ON-vs-OFF дифф — должен быть ~0.1–0.5% на ВСЕХ DPI (не 16% на 150).

---

## 7. Утилита ремонта PDF

`scripts/repair-pdf-flate.mjs` — чинит `/Length` расхождения в Flate-потоках (баг экспорта Illustrator: `/Length` на 4 байта меньше реального → mupdf «premature end of data in flate filter»). Данные при этом целы — патч без потерь.

```bash
node scripts/repair-pdf-flate.mjs input.pdf [output.pdf]
```

---

## 8. Известные проблемы / TODO

1. **Диалог Separations** (`separationBehaviors`) по-прежнему рендерится через C-glue single-путь (`toPixmapWithOverprintAndBehaviors` + `toRgb`) — на низких DPI там может проявляться тот же сдвиг изображения, что был исправлен для обычного overprint. Нужно перевести behaviors-путь на единый tiled-рендер с поддержкой behaviors (C-glue: `wasm_pdf_new_pixmap_from_page_with_usage_and_overprint_behaviors` + тайлы).
2. **CI Quality workflow падает** на 4 предсуществующих e2e: `app.spec.js:289/406/637`, `artwork-crop.spec.js:73` (падают и на чистом HEAD — не связаны с overprint).
3. **Медленные машины**: рендер больших файлов на высоких DPI может упираться в watchdog 180с → `pdfRenderTimeout` (сейчас тогл не откатывается, но превью остаётся низкого качества). Возможные пути: прогресс-индикация, адаптивный таймаут, кэш display list между рендерами одного документа.
4. **Illustrator-экспорт** может снова выдать PDF с битым `/Length` — гнать через `repair-pdf-flate.mjs`.
5. Воркер-кэш `renderCache` фактически не переиспользуется между рендерами PDF (каждый `openDocument` — новый docId → новый ключ). Не критично, но память можно сэкономить.

---

## 9. Как выглядит пользовательский сценарий

1. Импорт PDF/AI → превью (с overprint, если включён).
2. View → Overprint Preview — тогл; перерендер всех PDF-артворков (low-res сразу, high-res фоново); **галочка не слетает при ошибке**.
3. View → Separations… — диалог: C/M/Y/K coverage (read-only) + чекбоксы спотов; скрытая плашка → рендер с `separationBehaviors` (mode 2).
4. Шаг Render: качество артворка 150–2400 DPI — overprint виден на всех качествах (после `885751c`).

---

## 10. Полезные команды

```bash
npm run dev            # dev-сервер (порт 5173)
npm run preview        # собранный dist (4173)
npm run build          # сборка dist
npm run test:unit      # юнит
npx playwright test tests/e2e/overprint.spec.js   # e2e overprint
```

Деплой: push в `master` → GitHub Actions `Deploy to GitHub Pages` (автоматически). Проверка живого деплоя: воркер-чанк на сайте должен содержать `toDisplayList`.
