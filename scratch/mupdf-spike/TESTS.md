# MuPDF Overprint Spike — тестовые файлы

Фикстуры генерируются `scripts/generate-overprint-tests.mjs`, рендерятся
`scratch/mupdf-spike/render.mjs` в `scratch/mupdf-spike/out/*.png`.

Сравнивайте каждый тест в Adobe:
- Illustrator → View → Overprint Preview;
- Acrobat Pro → Output Preview → Simulate Overprinting.

Используйте одинаковые: page box (CropBox), zoom, фон страницы.

## Test 00 — Baseline
Четыре четверти: CMYK Cyan/Magenta/Yellow/Black. Проверка конвейера и
CMYK→RGB. Overprint не участвует.

## Test 01 — Black overprint
- Красный фон `0 0.9 0.85 0 k`.
- Поверх: прямоугольник 50% K с `op=true` и текст 100% K с `op=true`.
Ожидание (Adobe, Overprint Preview ON): фон сохраняется под чёрным —
прямоугольник выглядит тёмно-красным, без белых «окон» вокруг текста.

## Test 02 — Black knockout
Та же раскладка БЕЗ overprint flags. Ожидание: чёрные объекты выбивают фон —
50% K даёт серый на бумаге, текст выбивает красный (белые окна при симуляции
knockout).

## Test 03 — White overprint
- Жёлтый фон `0 0 1 0 k`.
- Слева: белый прямоугольник `0 0 0 0 k` с overprint fill ON.
- Справа: тот же белый прямоугольник БЕЗ overprint.
Ожидание (Adobe): левый прямоугольник невидим (фон сохранён), правый —
выбивает до бумажной белизны. **Ключевой тест.**

## Test 04 — OPM 0 / OPM 1
- Средне-фиолетовый фон `0.5 0.5 0 0 k`.
- Слева: PANTONE 185 C (alternate 0/0.91/0.72/0), overprint, `OPM 0`.
- Справа: то же с `OPM 1`.
Ожидание (Adobe): OPM 0 — не-нулевые компоненты заменяют фон; OPM 1 —
компоненты складываются (другой цвет).

## Test 05 — Spot color over CMYK
- CMYK фон `0.2 0.1 0 0.3 k`.
- PANTONE 185 C с overprint fill поверх.
Ожидание: красный спот смешивается с фоном (overprint), а не выбивает его.

## Test 06 — DeviceN
- Два colorant-а `INK1/INK2`, alternate DeviceCMYK.
- Tints 0.5/1.0 с overprint.
Ожидание: сложная краска корректно раскладывается в CMYK.

## Test 07 — Transparency + spot + overprint
- CMYK фон; Form XObject с прозрачной группой: PANTONE 185 C (overprint) +
  полупрозрачный жёлтый.
Ожидание: прозрачность, спот и overprint взаимодействуют корректно.

## Test 08 — Knockout groups
- Жёлтый фон; три группы: non-isolated, isolated, knockout.
- Внутри групп два перекрывающихся полупрозрачных прямоугольника.
Ожидание: в knockout-группе пересечение выбивается, в остальных — смешивается.

## Test 09 — PDF/X-1a
- Спот + overprint, плоская вёрстка, OutputIntent (CMYK-профиль).
Ожидание: корректный рендер спота и overprint в PDF/X.

## Test 10 — PDF/X-4
- Живая прозрачность + спот + ICC, OutputIntent.
Ожидание: корректный рендер прозрачности и спота.

## Test 11 — PDF-совместимый AI (.ai)
PDF-тело + AI-trailer после `%%EOF`. Приложение должно импортировать как
`pdf-compatible-ai`.

## Test 12 — Несовместимый AI (.ai)
Чистый PostScript без PDF. Приложение должно отклонить с понятной ошибкой
(`AI_NOT_PDF_COMPATIBLE`).
