# CartonBuilder Documentation Index

Этот файл — единый индекс документации проекта. Он отвечает на два вопроса:

1. является ли документ описанием текущего приложения;
2. кто и когда должен обновить документ после изменения кода.

## Статусы

Каждый документ в этом индексе должен иметь ровно один статус:

- **Implemented** — описывает поведение, которое уже поставлено в коде и
  подтверждено тестами или ручной проверкой.
- **Planned** — описывает согласованную, но ещё не полностью поставленную
  функциональность. Такой документ не должен формулировать план как текущий
  пользовательский контракт.
- **Historical/Research** — исходные требования, questionnaire, research,
  решения или устаревшая спецификация. Документ сохраняется для контекста, но
  не может переопределять Implemented-документы.

Для новых и изменяемых Markdown/HTML-документов статус указывается также в
первой секции самого документа. Для существующих legacy HTML/PDF-файлов таблица
ниже является источником статуса. Если статус в заголовке и индексе расходится,
сначала исправляется индекс, затем заголовок документа в том же изменении.

## Приоритет источников

При расхождении источники читаются в таком порядке:

1. реализованный код и актуальные unit/E2E tests;
2. этот индекс;
3. Implemented runtime specifications;
4. `README.md` как краткое описание продукта;
5. Planned и Historical/Research документы.

README не заменяет runtime specification. Research и roadmap не являются
доказательством того, что функция уже доступна пользователю.

## Каталог

| Статус | Документ | Назначение | Владелец актуальности |
| --- | --- | --- | --- |
| Implemented | [`README.md`](../README.md) | Краткий обзор продукта, запуск, ограничения и основные пользовательские функции | maintainer приложения |
| Historical/Research | [`0. box-net-builder-detailed-specification-ru.md`](0.%20box-net-builder-detailed-specification-ru.md) | Базовая спецификация Box Net и совместимости старого API | maintainer модели коробки; только исправления фактов |
| Historical/Research | [`1. artwork_placement_concept.html`](1.%20artwork_placement_concept.html) | Исходная концепция этапа Artwork | maintainer документации; не runtime-контракт |
| Historical/Research | [`2. questionare.html`](2.%20questionare.html) | Questionnaire и зафиксированные продуктовые вопросы | product owner |
| Historical/Research | [`3. artwork-placement-answers-2026-07-30.md`](3.%20artwork-placement-answers-2026-07-30.md) | Ответы, из которых формировался текущий workflow | product owner; не переопределяет код |
| Implemented | [`3. artwork-placement-runtime-specification.md`](3.%20artwork-placement-runtime-specification.md) | Нормативный контракт 2D Artwork, Preview, persistence и export | maintainer `src/artwork`, `src/project`, `src/preview3d` |
| Historical/Research | [`4. Browser-Based 3D for a Box-Net and Artwork App.pdf`](4.%20Browser-Based%203D%20for%20a%20Box-Net%20and%20Artwork%20App.pdf) | Исследовательские материалы по browser 3D | maintainer Render; только контекст |
| Historical/Research | [`5. carton_developer_technical_specification.html`](5.%20carton_developer_technical_specification.html) | Ранняя техническая спецификация до текущего workflow | maintainer документации; не нормативна |
| Historical/Research | [`5a. cartonbuilder-adapted-technical-specification.md`](5a.%20cartonbuilder-adapted-technical-specification.md) | Адаптированная ранняя спецификация CartonBuilder | maintainer документации; не нормативна |
| Historical/Research | [`6. 3D Rendering Strategy and Best Practices for CartonBuilder Research.md`](6.%203D%20Rendering%20Strategy%20and%20Best%20Practices%20for%20CartonBuilder%20Research.md) | Исследование стратегии качества и renderer choices | maintainer Render; предложения требуют отдельного решения |
| Planned | [`7. CartonBuilder 3D Rendering Research and Implementation Roadmap.md`](7.%20CartonBuilder%203D%20Rendering%20Research%20and%20Implementation%20Roadmap.md) | Roadmap дальнейших Render milestones и path tracing gate | maintainer Render |
| Historical/Research | [`8. 3D and HTML Inside PDF Research.md`](8.%203D%20and%20HTML%20Inside%20PDF%20Research.md) | Исследование PDF/HTML packaging и export boundaries | maintainer export; только контекст |
| Implemented | [`9. render-runtime-specification.md`](9.%20render-runtime-specification.md) | Нормативный контракт Presentation Render, effects и image/3D export | maintainer `src/render` |
| Historical/Research | [`10. mupdf-capability-spike.md`](10.%20mupdf-capability-spike.md) | Decision record: stock mupdf.js не симулирует overprint; нужен custom WASM wrapper | maintainer `src/artwork`, `src/pdf-renderer` |
| Implemented | [`11. mupdf-overprint-runtime-specification.md`](11.%20mupdf-overprint-runtime-specification.md) | Нормативный контракт custom MuPDF PDF/AI overprint, process/spot plates и single/tiled renderer; Adobe matrix остаётся release gate | maintainer `src/pdf-renderer`, `src/artwork` |
| Implemented | [`12. hdri-environment-runtime-specification.md`](12.%20hdri-environment-runtime-specification.md) | Нормативный контракт HDR/EXR environment maps, IBL, PMREM и archive v4 | maintainer `src/render`, `src/preview3d`, `src/project` |
| Implemented | [`13. geometry-fidelity-runtime-specification.md`](13.%20geometry-fidelity-runtime-specification.md) | Нормативный контракт толщины картона, surface-aware hinge и общей solid-геометрии Preview/Render/export | maintainer `src/model`, `src/preview3d`, `src/render`, `src/export` |
| Historical/Research | [`Техническое задание по внедрению MuPDF.js для PDF-AI Overprint Preview.htm`](Техническое%20задание%20по%20внедрению%20MuPDF.js%20для%20PDF-AI%20Overprint%20Preview.htm) | Входное ТЗ: внедрение MuPDF.js для PDF/AI Overprint Preview | maintainer `src/pdf-renderer` |
| Implemented | [`../handoff.md`](../handoff.md) | Точка передачи текущего состояния и backlog документации | текущий maintainer; обновлять при handoff |

## Правило «что считать Implemented»

Функция может быть отражена как Implemented только если выполнены все пункты:

1. она присутствует в production-коде;
2. её состояние и persistence описаны в соответствующей runtime specification;
3. есть unit/E2E coverage либо зафиксирована ручная browser-проверка;
4. описаны ограничения, fallback и feature flags, если они есть;
5. при изменении schema/archive указаны migration и compatibility rules.

Если один из пунктов отсутствует, документ остаётся Planned или получает
пометку «Implemented, documentation gap» в issue/PR до завершения проверки.

## Процесс обновления индекса

### При изменении функциональности

В том же PR/commit, где меняется код:

1. определить затронутый runtime-документ;
2. обновить поведение, ограничения и тестовые ссылки;
3. обновить README, если изменилась пользовательская возможность или команда
   запуска;
4. проверить, не нужно ли изменить статус roadmap/research-документа;
5. обновить строку каталога только при изменении назначения, статуса или
   владельца документа;
6. запустить `npm run test:unit`, `npm run build` и релевантные E2E;
7. выполнить `git diff --check` и убедиться, что документ не содержит
   утверждений, опровергнутых кодом.

### При добавлении нового документа

Новый документ обязан начинаться с короткого блока:

```markdown
Status: Implemented | Planned | Historical/Research
Owner: <module or role>
Last verified: YYYY-MM-DD
Canonical for: <scope, or "not canonical">
```

После этого файл добавляется в таблицу выше в том же PR. Документы без строки в
индексе считаются вспомогательными и не могут использоваться как нормативный
источник.

### При переводе Planned → Implemented

Нужно указать commit/PR, тесты, migration или fallback (если применимо), а для
визуальных функций — browser screenshot или ручной QA checklist. После этого
обновляются заголовок документа, таблица и README.

### Для Historical/Research документов

Они не переписываются под каждое изменение продукта. Разрешены только:

- исправления явных ошибок и ссылок;
- добавление даты/статуса;
- ссылка на актуальную Implemented specification;
- перевод решения в отдельный Planned или Implemented документ.

## Текущий backlog документации

Перед следующим release нужно повторно сверить Implemented-документы с кодом и
тестами Wave 6:

- динамические artwork sublayers, Scale X/Y и независимый `Constrain proportions`;
- archive manifest version 4, массивы assets/previews, render-assets и импорт v1-v3;
- HDRI/EXR environment maps, linear-light 1K/2K/4K runtime caps, bounded
  two-entry PMREM cache, usage modes, diagnostics and custom-map recovery;
- сохранение раскладки при изменении Box Dimensions и отдельный Reset Box;
- File/Edit menus, Contacts, Box Presets, scene presets и diagnostics;
- Render preflight, Floor Reflection strength/softness/fade и PNG/JPG export UI;
- DPR 1/2, Chrome/Edge matrix и stress-test evidence.

Wave 8A geometry fidelity is the current release gate: canonical board caliper,
surface-aware solid hinges, Preview/Render/export parity, schema v13 migration,
unit and Chromium/Edge geometry checks, production build and `graphify update .`.
Flaps, lock tabs and production crease allowance remain Wave 8B/9 scope.

Этот список является release-проверкой фактов, а не основанием считать
непроверенную функцию Implemented.

## Минимальная release-проверка документации

Перед merge/release maintainer должен проверить:

- [ ] `docs/README.md` содержит каждый документ в `docs/`;
- [ ] каждый документ имеет один статус и понятного владельца;
- [ ] Implemented docs совпадают с кодом и тестами;
- [ ] README описывает доступные пользователю шаги и ограничения;
- [ ] HDRI release gate includes effective-cap, LRU, fallback and recovery
  evidence; transient diagnostics are not persisted;
- [ ] schema/archive changes имеют migration notes;
- [ ] Planned функции не выдаются за текущие;
- [ ] Historical/Research документы явно помечены как ненормативные;
- [ ] Render preflight, diagnostics health and visual baselines pass;
- [ ] `npm run test:unit`, `npm run build` и нужные E2E прошли.
