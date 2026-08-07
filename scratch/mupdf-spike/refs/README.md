# Adobe-референсы для MuPDF Overprint Spike

Положите сюда PNG, экспортированные из Adobe, и скажите «готово».

## Именование файлов

Для каждого теста — до двух PNG (можно один):

- `<тест>-AI.png` — из Illustrator (View → Overprint Preview ON)
- `<тест>-Acrobat.png` — из Acrobat Pro (Output Preview → Simulate Overprinting)

Примеры:
```
test-01-black-overprint-AI.png
test-01-black-overprint-Acrobat.png
test-03-white-overprint-AI.png
test-04-opm-0-1-AI.png
...
```

## Требования к каждому снимку

- Показывать **всю страницу** (вид «вписать в окно», CropBox), без поворота.
- Желательно **800×800 px** (страница 400×400 pt): в Illustrator — PNG 200%;
  в Acrobat — PNG 144 DPI. Если не получается ровно — любой размер ≥400 px,
  масштаб по осям выровняется автоматически по размеру.
- Фон белый, без UI-панелей.

## Обязательные тесты (семантика overprint)

- `test-01-black-overprint` — ожидание: фон сохраняется под чёрным (тёмно-красный,
  без белых окон). Дополнительно полезно: снимок с **выключенным** Overprint Preview.
- `test-02-black-knockout` — ожидание: фон выбивается (серый, белые окна).
- `test-03-white-overprint` — ожидание: левый белый прямоугольник НЕВИДИМ,
  правый — белый. Снимите и с выключенным Overprint Preview.
- `test-04-opm-0-1` — ожидание: левая (OPM 0) и правая (OPM 1) колонки РАЗНЫЕ.

## Желательные тесты (спот/прозрачность)

- `test-05-spot-over-cmyk`, `test-06-devicen`, `test-07-transparency-spot`,
  `test-08-knockout-groups`, `test-09-pdfx1a`, `test-10-pdfx4`.

## Тесты AI

- `test-11-ai-compatible.ai` — откройте в Illustrator: должен открыться как PDF.
  Снимок (любой размер) + подтверждение, что открылся.
- `test-12-non-compatible-ai.ai` — Illustrator выдаст ошибку/не откроет.
  Достаточно текста сообщения (или скриншота диалога).

## Как собрать сравнение

```bash
node scripts/compare-overprint.mjs
```

Скрипт возьмёт референсы из `refs/`, сгенерирует side-by-side сетки
(`refs/compare/<тест>-compare.png`: Adobe-AI | Adobe-Acrobat | mupdf-Print | mupdf-View)
и запишет таблицу probe-пикселей в `refs/compare/compare-report.json`.
